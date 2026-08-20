import { NextResponse } from "next/server";

/**
 * Catch-all runtime proxy: /api/<anything> -> FastAPI /api/<anything>.
 *
 * Keeping the browser on a same-origin path means no CORS config and no
 * backend URL baked into the client bundle at build time.
 */
const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

async function proxy(request, { params }) {
  const { path } = await params;
  const search = new URL(request.url).search;
  const target = `${BACKEND_URL}/api/${path.join("/")}${search}`;

  const hasBody = !["GET", "HEAD"].includes(request.method);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });

    const text = await upstream.text();
    return new NextResponse(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    console.error(`Proxy error for ${target}:`, error);
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
