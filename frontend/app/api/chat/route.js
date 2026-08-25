import { proxyStreamingPost } from "@/lib/server/streamProxy";

/** Chat with the fraud agent. See `lib/server/streamProxy.js` for why this
 *  route exists instead of falling through to the catch-all proxy. */
export async function POST(request) {
  return proxyStreamingPost(request, "/api/chat");
}
