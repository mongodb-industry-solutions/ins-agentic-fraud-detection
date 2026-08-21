/**
 * Transport for the fraud agent chat protocol: everything about *how* a message
 * is sent and how the response stream is framed lives here, so the React layer
 * only decides what to do with each event.
 *
 * Browser-side only. The endpoints are same-origin `/api/chat*` paths; the API
 * key lives in the FastAPI backend, so nothing here ever sees a credential.
 */

// Upstream provider errors sometimes arrive as a Python-repr string rather than
// JSON (e.g. `Error code: 400 - {'error': {'message': "...", ...}}`). This pulls
// out the human-readable half; best-effort only, so callers fall back to the raw
// text when it does not match.
const PROVIDER_ERROR_MESSAGE_PATTERN = /'message':\s*"([^"]*)"/;

const SSE_DATA_PREFIX = "data: ";
const SSE_DONE_SENTINEL = "data: [DONE]";

function extractErrorMessage(raw) {
  const match = typeof raw === "string" ? raw.match(PROVIDER_ERROR_MESSAGE_PATTERN) : null;
  return match ? match[1] : raw;
}

/** `suspend_context` arrives as a JSON string, not an object — parse defensively. */
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Sends one turn to the agent and drives its SSE response, invoking a handler
 * per event as it arrives.
 *
 * `handlers` — all optional: `onText(chunk)`, `onProgress(activity)`,
 * `onSuspend({ reason, context, executionId })`, `onDone()`,
 * `onSessionId(executionId)`, `onStreamError(reason)`. None may throw; the read
 * loop has no per-handler recovery.
 *
 * `onSessionId` fires on the **terminal** frame only. The execution id it
 * carries is the conversation handle, but only the first turn's is — the
 * write-once rule lives in `useFraudChat`, not here.
 *
 * Resolves `{ text, errorReason, suspendInfo }`. Rejects if the request itself
 * fails, including `AbortError` when `signal` aborts — on rejection nothing is
 * returned at all, so a caller that wants the partial answer after a mid-stream
 * failure has to accumulate it from `onText`. An *in-stream* error is not a
 * rejection: the stream completed normally, so it surfaces as `errorReason`.
 */
export async function streamAgentMessage({ message, sessionId, userId, signal }, handlers = {}) {
  const { onText, onProgress, onSuspend, onDone, onSessionId, onStreamError } = handlers;

  let text = "";
  let errorReason = null;
  let suspendInfo = null;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      // Omitted, never sent as null: "absent" is how the engine is told to
      // start a new conversation, and a literal null does not mean the same.
      // camelCase is deliberate — `/api/chat` is the translation boundary, so
      // the platform's snake_case never reaches client code.
      ...(sessionId && { sessionId }),
      ...(userId && { userId }),
    }),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // A network chunk can split mid-line. The trailing fragment is held over
    // and prepended to the next chunk rather than parsed as a truncated frame.
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === SSE_DONE_SENTINEL) continue;

      const raw = trimmed.startsWith(SSE_DATA_PREFIX)
        ? trimmed.slice(SSE_DATA_PREFIX.length)
        : trimmed;

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Not a JSON frame — the platform occasionally emits bare text. Treat
        // it as content rather than dropping it.
        if (raw) {
          text += raw;
          onText?.(raw);
        }
        continue;
      }

      // The opening `metadata` frame also carries an execution id, but the
      // handle is taken from the terminal frame — a conversation that never
      // produced a reply is not one worth rehydrating.
      if (parsed.chunk_type === "metadata") continue;

      if (parsed.chunk_type === "done") {
        if (parsed.execution_id) onSessionId?.(parsed.execution_id);

        if (parsed.metadata?.status === "suspended") {
          const context = safeJsonParse(parsed.metadata.suspend_context);
          suspendInfo = { reason: parsed.metadata.suspend_reason, context };
          onSuspend?.({
            reason: parsed.metadata.suspend_reason,
            context,
            executionId: parsed.execution_id,
          });
          continue;
        }

        onDone?.();
        continue;
      }

      if (parsed.chunk_type === "error") {
        errorReason = extractErrorMessage(
          parsed.content || parsed.error || parsed.message || "Unknown error"
        );
        onStreamError?.(errorReason);
        continue;
      }

      if (parsed.chunk_type === "progress") {
        onProgress?.(parsed.content ?? "");
        continue;
      }

      if (parsed.chunk_type !== "text") continue;

      const chunk = parsed.content ?? "";
      if (chunk) {
        text += chunk;
        onText?.(chunk);
      }
    }
  }

  return { text, errorReason, suspendInfo };
}
