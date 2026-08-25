/**
 * Server-only streaming proxy to the FastAPI backend.
 *
 * The catch-all at `app/api/[...path]` cannot serve these routes: it does
 * `await upstream.text()`, which buffers the whole answer and delivers it in one
 * block. Any agent route that streams needs its own route file, and they all
 * need exactly this passthrough — hence one helper rather than a copy per route.
 */
const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

/** Header carrying the agent conversation handle; must survive both hops. */
const SESSION_HEADER = "x-session-id";

/**
 * Pipes a POST through to `BACKEND_URL + path`, forwarding the SSE bytes and the
 * session header untouched. `path` starts with a slash, e.g. `/api/chat`.
 */
export async function proxyStreamingPost(request, path) {
  const target = `${BACKEND_URL}${path}`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      // A closed modal or an abandoned assessment should tear down the whole
      // chain rather than leaving the agent streaming into nothing.
      signal: request.signal,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new Response(text || JSON.stringify({ error: `HTTP ${upstream.status}` }), {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "application/json",
        },
      });
    }

    const sessionId = upstream.headers.get(SESSION_HEADER);

    // Bytes pass through untouched — SSE framing is parsed in the browser, so a
    // new chunk_type never touches this file.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
        // Dropping this would silently cost the agent its memory: the browser
        // has no other source for the conversation handle.
        ...(sessionId && { [SESSION_HEADER]: sessionId }),
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    // The reviewer closed the modal or navigated away. Node surfaces this as
    // ResponseAborted rather than AbortError depending on where in the request
    // it lands, and neither is a server fault worth logging as one.
    if (error.name === "AbortError" || error.name === "ResponseAborted") {
      return new Response(null, { status: 499 });
    }
    console.error(`Stream proxy error for ${target}:`, error);
    return Response.json({ error: "Agent backend unreachable" }, { status: 502 });
  }
}
