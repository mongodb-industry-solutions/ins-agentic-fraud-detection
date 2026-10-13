import { proxyStreamingPost } from "@/lib/server/streamProxy";

/** Run the agent's fraud assessment on one claim, streaming the result. */
export async function POST(request, { params }) {
  const { claimId } = await params;
  return proxyStreamingPost(request, `/api/fraud-assessment/${encodeURIComponent(claimId)}`);
}
