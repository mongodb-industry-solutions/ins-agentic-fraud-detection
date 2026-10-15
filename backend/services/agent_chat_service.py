"""Server-side proxy to the fraud assessment agent on the MongoDB Agentic Platform.

Two rules shape this module:

1. The browser never sees the API key. This is the only place the
   `Authorization: Bearer` header is attached, which is why the frontend talks
   to `/api/chat` instead of the platform directly.
2. The server never parses the stream. `invoke_stream` forwards upstream bytes
   untouched and the SSE frames are decoded in the browser, so adding a new
   `chunk_type` never requires a backend change.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator

import httpx

from core.config import Settings
from core.exceptions import AgentNotConfiguredError, AgentUpstreamError

logger = logging.getLogger(__name__)

# The stream stays open for as long as the agent is thinking, so there is no
# read timeout — only a bound on establishing the connection.
STREAM_TIMEOUT = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)
REQUEST_TIMEOUT = httpx.Timeout(30.0)

# Access tokens last an hour; refresh this many seconds early so a token never
# expires mid-request.
TOKEN_REFRESH_MARGIN = 60.0

# Magenta returns the conversation handle in a response *header*, not in the
# body. The body's `execution_id` identifies a single run and must never be used
# to continue a conversation — doing so opens a new one on every turn.
SESSION_HEADER = "x-session-id"

# ...and it must be sent back the same way. Measured against this deployment:
# passing the id in the request *body* as `session_id` is silently ignored — the
# response comes back with a brand-new session id and the agent has no history.
# Sent as this request header, the same id is echoed back and the conversation
# continues. Both are sent, since the body field is the documented contract and
# doing both is confirmed to work; the header is what actually carries it today.
SESSION_REQUEST_HEADER = "X-Session-ID"


class AgentChatService:
    """Invoke, resume and status calls against one configured agent workspace."""

    def __init__(self, settings: Settings):
        self._settings = settings
        # Cached service-account access token and its monotonic expiry time.
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._token_lock = asyncio.Lock()

    # ---------------------------------------------------------------- helpers

    def _credentials(self) -> tuple[str, str]:
        """Return (project_id, workspace_id) or explain what is missing.

        Checked per request rather than at import so the rest of the API still
        boots — and still serves claims — on a machine with no agent configured.
        """
        settings = self._settings
        has_service_account = bool(
            settings.FRAUD_AGENT_CLIENT_ID and settings.FRAUD_AGENT_CLIENT_SECRET
        )
        required = [
            ("FRAUD_AGENT_PROJECT_ID", settings.FRAUD_AGENT_PROJECT_ID),
            ("FRAUD_AGENT_WORKSPACE_ID", settings.FRAUD_AGENT_WORKSPACE_ID),
            ("AGENT_BASE_URL", settings.AGENT_BASE_URL),
        ]
        if not has_service_account and not settings.FRAUD_AGENT_API_KEY:
            required[:0] = [
                ("FRAUD_AGENT_CLIENT_ID", settings.FRAUD_AGENT_CLIENT_ID),
                ("FRAUD_AGENT_CLIENT_SECRET", settings.FRAUD_AGENT_CLIENT_SECRET),
            ]
        missing = [name for name, value in required if not value]
        if missing:
            raise AgentNotConfiguredError(
                f"Fraud agent is not configured — missing: {', '.join(missing)}",
                details={"missing": missing},
            )
        return settings.FRAUD_AGENT_PROJECT_ID, settings.FRAUD_AGENT_WORKSPACE_ID

    @property
    def _base_url(self) -> str:
        """Only ever read after `_credentials()` has confirmed it is set."""
        return (self._settings.AGENT_BASE_URL or "").rstrip("/")

    @property
    def _token_url(self) -> str:
        return self._settings.AGENT_TOKEN_URL or f"{self._base_url}/oauth/token"

    async def _access_token(self) -> str:
        """Bearer credential for the platform.

        With a service account, exchanges the client id/secret for an access
        token (client_credentials grant) and caches it until shortly before it
        expires. Without one, falls back to the static API key.
        """
        settings = self._settings
        client_id = settings.FRAUD_AGENT_CLIENT_ID
        client_secret = settings.FRAUD_AGENT_CLIENT_SECRET
        if not (client_id and client_secret):
            return settings.FRAUD_AGENT_API_KEY or ""

        if self._token and time.monotonic() < self._token_expires_at:
            return self._token

        async with self._token_lock:
            # Another request may have refreshed while this one waited.
            if self._token and time.monotonic() < self._token_expires_at:
                return self._token
            try:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                    response = await client.post(
                        self._token_url,
                        auth=(client_id, client_secret),
                        data={"grant_type": "client_credentials"},
                    )
            except httpx.HTTPError as error:
                logger.error("Agent token request failed: %s", error)
                raise AgentUpstreamError(
                    f"Could not reach the agent token endpoint: {error}"
                ) from error
            if response.status_code >= 400:
                logger.error(
                    "Agent token endpoint %s: %s", response.status_code, response.text
                )
                raise AgentUpstreamError(
                    f"Agent token request returned HTTP {response.status_code}",
                    status_code=response.status_code,
                )
            body = response.json()
            self._token = body["access_token"]
            lifetime = float(body.get("expires_in", 3600))
            self._token_expires_at = time.monotonic() + max(lifetime - TOKEN_REFRESH_MARGIN, 0)
            return self._token

    def _invalidate_token(self) -> None:
        self._token = None
        self._token_expires_at = 0.0

    async def _headers(self) -> dict[str, str]:
        token = await self._access_token()
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # ----------------------------------------------------------------- invoke

    async def invoke_stream(
        self,
        message: str,
        session_id: str | None,
        user_id: str | None,
    ) -> tuple[AsyncIterator[bytes], str, str | None]:
        """Open the agent's SSE stream.

        Returns (byte iterator, content type, session id). The session id is read
        from the upstream `x-session-id` header, which is available as soon as the
        response headers land — before any tokens — so a new conversation has its
        handle from the very first turn.

        The connection is established here, before the response is handed to
        Starlette, so an upstream 401/404 becomes that same status on our own
        response instead of a 200 whose body happens to contain an error.
        """
        project_id, workspace_id = self._credentials()
        url = (
            f"{self._base_url}/projects/{project_id}"
            f"/workspaces/{workspace_id}/invokeStream"
        )

        payload: dict[str, str] = {"message": message}
        # Sent only when present: absent is how Magenta is told "start a new
        # conversation", which is not the same as an explicit null. The value
        # must be one Magenta itself issued via `x-session-id` — an id we invent,
        # or an `execution_id` from a response body, opens a new conversation.
        if session_id:
            payload["session_id"] = session_id
        # `user_id` is deliberately not forwarded. The gateway rejects (403) any
        # `user_id` that differs from the API key's owner unless the project has
        # end-user delegation enabled, and the browser's anonymous id never
        # matches. Without it the agent runs as the key's owner. Re-add
        # `payload["user_id"] = user_id` once delegation is enabled.

        client = httpx.AsyncClient(timeout=STREAM_TIMEOUT)
        try:
            # A 401 on a service-account token means it was revoked or expired
            # early: drop it and retry once with a fresh one.
            for attempt in (1, 2):
                headers = await self._headers()
                if session_id:
                    headers[SESSION_REQUEST_HEADER] = session_id
                request = client.build_request("POST", url, json=payload, headers=headers)
                response = await client.send(request, stream=True)
                if response.status_code != 401 or attempt == 2 or not self._token:
                    break
                await response.aclose()
                self._invalidate_token()
        except AgentUpstreamError:
            await client.aclose()
            raise
        except httpx.HTTPError as error:
            await client.aclose()
            logger.error("Agent stream could not be opened: %s", error)
            raise AgentUpstreamError(f"Could not reach the fraud agent: {error}") from error

        if response.status_code >= 400:
            body = (await response.aread()).decode(errors="replace")
            await response.aclose()
            await client.aclose()
            logger.error("Agent invokeStream %s: %s", response.status_code, body)
            raise AgentUpstreamError(
                f"Agent returned HTTP {response.status_code}",
                status_code=response.status_code,
            )

        content_type = response.headers.get("content-type") or "text/event-stream"
        return (
            self._drain(client, response),
            content_type,
            response.headers.get(SESSION_HEADER),
        )

    @staticmethod
    async def _drain(client: httpx.AsyncClient, response: httpx.Response) -> AsyncIterator[bytes]:
        """Forward upstream bytes verbatim, closing both handles on any exit.

        `finally` also covers the client disconnecting mid-answer, which raises
        out of the yield and would otherwise leak the upstream connection.

        `aiter_bytes` rather than `aiter_raw`: httpx negotiates gzip, and only
        this iterator undoes it — raw bytes would be forwarded still compressed
        under a `text/event-stream` content type.
        """
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    # -------------------------------------------------- human-review plumbing

    async def resume(self, execution_id: str, decision: str) -> tuple[int, bytes, str]:
        """Submit an approve/deny decision. Returns the upstream reply verbatim."""
        project_id, workspace_id = self._credentials()
        url = f"{self._base_url}/projects/{project_id}/executions/{execution_id}/resume"
        return await self._passthrough(
            "POST",
            url,
            params={"workspace_id": workspace_id},
            json={"decision": decision},
        )

    async def status(self, execution_id: str) -> tuple[int, bytes, str]:
        """Read an execution's current state. Returns the upstream reply verbatim."""
        project_id, workspace_id = self._credentials()
        url = f"{self._base_url}/projects/{project_id}/executions/{execution_id}"
        return await self._passthrough(
            "GET", url, params={"workspace_id": workspace_id}
        )

    async def _passthrough(
        self,
        method: str,
        url: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
    ) -> tuple[int, bytes, str]:
        """Relay one non-streaming call, body and status untouched.

        Nothing here interprets the payload — the shape of an execution record
        is the platform's contract with the client, not with this service.
        """
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                for attempt in (1, 2):
                    response = await client.request(
                        method, url, params=params, json=json, headers=await self._headers()
                    )
                    if response.status_code != 401 or attempt == 2 or not self._token:
                        break
                    self._invalidate_token()
        except httpx.HTTPError as error:
            logger.error("Agent %s %s failed: %s", method, url, error)
            raise AgentUpstreamError(f"Could not reach the fraud agent: {error}") from error

        content_type = response.headers.get("content-type") or "application/json"
        return response.status_code, response.content, content_type
