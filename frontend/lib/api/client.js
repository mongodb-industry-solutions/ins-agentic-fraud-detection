/** Transport layer. The only place fetch() is called. */

/**
 * The API answers failures in three shapes, and a caller that renders
 * `error.message` needs a sentence out of all of them:
 *   - domain errors: {error: "not_found", message: "…"} — the message, not the code
 *   - schema errors (422): {detail: [{loc, msg}, …]} — one entry per bad field
 *   - anything else: the status
 */
function toErrorMessage(payload, status) {
  const detail = payload?.detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        // "body" is always the first element and says nothing to a reader.
        const field = (item.loc || []).filter((part) => part !== "body").join(".");
        return field ? `${field}: ${item.msg}` : item.msg;
      })
      .join("; ");
  }

  return payload?.message || detail || payload?.error || `Request failed (${status})`;
}

export async function apiFetch(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });

  const text = await response.text();
  // Not every failure is JSON: an unhandled backend error, or a proxy, answers
  // with plain text ("Internal Server Error"). Parsing that blindly turned a
  // clear failure into "Unexpected token 'I'… is not valid JSON".
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = response.ok ? text : { message: `The server answered ${response.status}: ${text.slice(0, 160)}` };
    }
  }

  if (!response.ok) {
    const error = new Error(toErrorMessage(payload, response.status));
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function toQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}
