import { apiFetch, toQuery } from "./client";

/** The whole catalogue — unpaginated, because the backend route is too. */
export function listFraudPatterns({ patternType = "ALL", active, sort } = {}) {
  const query = toQuery({
    patternType: patternType === "ALL" ? undefined : patternType,
    active: active === undefined ? undefined : String(active),
    sort,
  });
  return apiFetch(`/fraud-patterns${query}`);
}

/**
 * The top N active patterns by trigger volume, with their `whyEffective` blurb.
 *
 * A dedicated endpoint rather than `listFraudPatterns` sorted and sliced here:
 * the ranking is decided server-side, and the generated narrative is attached
 * only for the rows actually being returned.
 *
 * The response carries `rankedBy` and `totalActivePatternCount`, so a caption
 * can name the real ranking metric and catalogue size instead of assuming them.
 */
export function getTopPatternsLeaderboard({ limit = 5 } = {}) {
  return apiFetch(`/fraud-patterns/leaderboard${toQuery({ limit })}`);
}

/** A pattern plus the claims it actually fired on. */
export function getFraudPatternDetail(patternId) {
  return apiFetch(`/fraud-patterns/${patternId}`);
}

/**
 * Partial update of a pattern's editable configuration: active, name,
 * description, severity, weight. Resolves with the updated pattern.
 *
 * What a pattern *matches* (ruleLogic, appliesTo, embeddingText) is rejected by
 * this endpoint — changing it invalidates the stats already accumulated against
 * it, so it needs its own flow.
 */
export function updateFraudPattern(patternId, payload) {
  return apiFetch(`/fraud-patterns/${patternId}`, { method: "PATCH", body: payload });
}

/**
 * Adds a pattern to the catalogue. The id, the zeroed stats and the timestamps
 * are assigned server-side, so they are absent from the payload.
 *
 * A HISTORICAL_SIMILARITY pattern is created without an embedding and takes no
 * part in similarity matching until the embedding procedure runs — the response
 * flags that as `embeddingPending`.
 */
export function createFraudPattern(payload) {
  return apiFetch("/fraud-patterns", { method: "POST", body: payload });
}
