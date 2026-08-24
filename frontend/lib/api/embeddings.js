import { apiFetch } from "./client";

/**
 * Embed one document's source text and store the vector on it.
 *
 * `target` is one of the API's two allowlisted collections: "claims" or
 * "fraud_patterns". The vector is always generated as input_type="document" —
 * the endpoint does not accept a choice, because a "query" vector written into
 * the corpus silently degrades every score against that document.
 */
export function embedDocument(target, documentId, { force = false } = {}) {
  return apiFetch(`/embeddings/documents/${target}/${documentId}?force=${force}`, {
    method: "POST",
  });
}

/**
 * How much of a collection is embedded, which model does it, and whether the
 * Atlas vector index exists. Embeds nothing, so it is safe to call just to
 * read the model name back.
 */
export function getEmbeddingStatus(target) {
  return apiFetch(`/embeddings/collections/${target}`);
}
