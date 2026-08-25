import { proxyStreamingPost } from "@/lib/server/streamProxy";

/**
 * Hand the reviewer's verdict to the agent that ran the assessment, streaming
 * its confirmation of what it wrote.
 *
 * Needs its own route file for the same reason the assessment does: the
 * catch-all at `app/api/[...path]` buffers with `await upstream.text()`, so
 * without this the whole agent run would arrive in one block at the end and the
 * reviewer would watch a frozen panel while it wrote to the database.
 */
export async function POST(request, { params }) {
  const { claimId } = await params;
  return proxyStreamingPost(
    request,
    `/api/fraud-assessment/${encodeURIComponent(claimId)}/decision`
  );
}
