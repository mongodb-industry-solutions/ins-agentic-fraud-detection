/**
 * Streaming proxy for the fraud agent chat: /api/chat -> FastAPI /api/chat.
 *
 * This route exists only because the catch-all proxy at `app/api/[...path]`
 * buffers the whole upstream body with `await upstream.text()`, which would
 * hold the entire answer back and deliver it in one block. A more specific
 * route wins over the catch-all, so POST /api/chat lands here and streams;
 * /api/chat/resume and /api/chat/status still go through the catch-all, which
 * is correct for them since neither response is a stream.
 */
const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

export async function POST(request) {
  const target = `${BACKEND_URL}/api/chat`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      // The user closing the modal mid-answer should tear down the whole chain.
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

    // Bytes pass through untouched — SSE framing is parsed in the browser by
    // `lib/api/agentChat.js`, so a new chunk_type never touches this file.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error.name === "AbortError") return new Response(null, { status: 499 });
    console.error(`Chat proxy error for ${target}:`, error);
    return Response.json({ error: "Agent backend unreachable" }, { status: 502 });
  }
}
