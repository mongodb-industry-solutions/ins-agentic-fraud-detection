"""Server-side proxy to the fraud assessment agent on the MongoDB Agentic Platform.

Two rules shape this module:

1. The browser never sees the API key. This is the only place the
   `Authorization: Bearer` header is attached, which is why the frontend talks
   to `/api/chat` instead of the platform directly.
2. The server never parses the stream. `invoke_stream` forwards upstream bytes
   untouched and the SSE frames are decoded in the browser, so adding a new
   `chunk_type` never requires a backend change.
"""

import logging
from collections.abc import AsyncIterator

import httpx

from core.config import Settings
from core.exceptions import AgentNotConfiguredError, AgentUpstreamError

logger = logging.getLogger(__name__)

# The stream stays open for as long as the agent is thinking, so there is no
# read timeout — only a bound on establishing the connection.
STREAM_TIMEOUT = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)
REQUEST_TIMEOUT = httpx.Timeout(30.0)


class AgentChatService:
    """Invoke, resume and status calls against one configured agent workspace."""

    def __init__(self, settings: Settings):
        self._settings = settings

    # ---------------------------------------------------------------- helpers

    def _credentials(self) -> tuple[str, str, str]:
        """Return (api_key, project_id, workspace_id) or explain what is missing.

        Checked per request rather than at import so the rest of the API still
        boots — and still serves claims — on a machine with no agent configured.
        """
        settings = self._settings
        missing = [
            name
            for name, value in (
                ("FRAUD_AGENT_API_KEY", settings.FRAUD_AGENT_API_KEY),
                ("FRAUD_AGENT_PROJECT_ID", settings.FRAUD_AGENT_PROJECT_ID),
                ("FRAUD_AGENT_WORKSPACE_ID", settings.FRAUD_AGENT_WORKSPACE_ID),
                ("AGENT_BASE_URL", settings.AGENT_BASE_URL),
            )
            if not value
        ]
        if missing:
            raise AgentNotConfiguredError(
                f"Fraud agent is not configured — missing: {', '.join(missing)}",
                details={"missing": missing},
            )
        return (
            settings.FRAUD_AGENT_API_KEY,
            settings.FRAUD_AGENT_PROJECT_ID,
            settings.FRAUD_AGENT_WORKSPACE_ID,
        )

    @property
    def _base_url(self) -> str:
        """Only ever read after `_credentials()` has confirmed it is set."""
        return (self._settings.AGENT_BASE_URL or "").rstrip("/")

    def _headers(self, api_key: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # ----------------------------------------------------------------- invoke

    async def invoke_stream(
        self,
        message: str,
        session_id: str | None,
        user_id: str | None,
    ) -> tuple[AsyncIterator[bytes], str]:
        """Open the agent's SSE stream and return (byte iterator, content type).

        The connection is established here, before the response is handed to
        Starlette, so an upstream 401/404 becomes that same status on our own
        response instead of a 200 whose body happens to contain an error.
        """
        api_key, project_id, workspace_id = self._credentials()
        url = (
            f"{self._base_url}/projects/{project_id}"
            f"/workspaces/{workspace_id}/invokeStream"
        )

        payload: dict[str, str] = {"message": message}
        # Sent only when present: the platform treats an absent session_id as
        # "start a new conversation", where an explicit null is a bad request.
        if session_id:
            payload["session_id"] = session_id
        if user_id:
            payload["user_id"] = user_id

        client = httpx.AsyncClient(timeout=STREAM_TIMEOUT)
        try:
            request = client.build_request(
                "POST", url, json=payload, headers=self._headers(api_key)
            )
            response = await client.send(request, stream=True)
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
        return self._drain(client, response), content_type

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
        api_key, project_id, workspace_id = self._credentials()
        url = f"{self._base_url}/projects/{project_id}/executions/{execution_id}/resume"
        return await self._passthrough(
            "POST",
            url,
            api_key,
            params={"workspace_id": workspace_id},
            json={"decision": decision},
        )

    async def status(self, execution_id: str) -> tuple[int, bytes, str]:
        """Read an execution's current state. Returns the upstream reply verbatim."""
        api_key, project_id, workspace_id = self._credentials()
        url = f"{self._base_url}/projects/{project_id}/executions/{execution_id}"
        return await self._passthrough(
            "GET", url, api_key, params={"workspace_id": workspace_id}
        )

    async def _passthrough(
        self,
        method: str,
        url: str,
        api_key: str,
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
                response = await client.request(
                    method, url, params=params, json=json, headers=self._headers(api_key)
                )
        except httpx.HTTPError as error:
            logger.error("Agent %s %s failed: %s", method, url, error)
            raise AgentUpstreamError(f"Could not reach the fraud agent: {error}") from error

        content_type = response.headers.get("content-type") or "application/json"
        return response.status_code, response.content, content_type
