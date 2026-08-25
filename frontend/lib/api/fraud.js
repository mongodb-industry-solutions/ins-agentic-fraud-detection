import { apiFetch, toQuery } from "./client";

/** Mirrors backend/routers/fraud.py. */

export function getPortfolioStats({ dateFrom, dateTo, bucket = "week" } = {}) {
  return apiFetch(`/fraud/portfolio-stats${toQuery({ dateFrom, dateTo, bucket })}`);
}

/**
 * `days` windows the feed; `agentOnly` narrows it to the agent's own actions,
 * excluding human decisions and claim openings.
 */
export function getRecentActivity({ limit = 20, days, agentOnly } = {}) {
  return apiFetch(`/fraud/recent-activity${toQuery({ limit, days, agentOnly })}`);
}

/** Scored claims still awaiting a confirm/dismiss decision. */
export function getPendingQueue({ limit = 10 } = {}) {
  return apiFetch(`/fraud/pending-queue${toQuery({ limit })}`);
}

/**
 * Claims linked by shared customer, repair shop or fraud pattern.
 *
 * One edge per pair of claims however many reasons connect them: the reasons
 * are collected onto `edge.reasons`, and `edge.type` is the strongest of them,
 * which is what the line style encodes. `node.status` is resolved server-side —
 * do not re-derive it from fraudFlag + processed.
 */
export function getRelationshipGraph({ scope = "ALL", limit = 60 } = {}) {
  return apiFetch(`/fraud/relationship-graph${toQuery({ scope, limit })}`);
}

/**
 * The same connections as the graph, ranked as a flat triage list.
 *
 * `limit` caps returned clusters, not claims; the response's `total` says how
 * many were found, so a truncated list still reports what it left out.
 */
export function getSimilarityLeaderboard({ scope = "ALL", limit = 10 } = {}) {
  return apiFetch(`/fraud/similarity-leaderboard${toQuery({ scope, limit })}`);
}

/**
 * Customers, repair shops or adjusters recurring across open or flagged claims.
 *
 * `entityType` is a required backend parameter, not a client-side slice of one
 * combined result — switching it is a new request.
 */
export function getRepeatEntities({ entityType, minAppearances = 2 } = {}) {
  return apiFetch(`/fraud/repeat-entities${toQuery({ entityType, minAppearances })}`);
}

/**
 * Outcome counts and confirmed-fraud rate grouped by one claim dimension.
 *
 * `dimension` is required and decides the aggregation the backend runs — a
 * plain $group for category fields, a $bucket for the two numeric ones. There
 * is no combined response to re-slice client-side, so switching dimension is a
 * new request.
 *
 * Each row's `label` is the display text and comes from the response: bucket
 * boundaries are server-side and get recalibrated, so labels are never built
 * here. `value` is the stable key.
 */
export function getFraudRateBreakdown(dimension) {
  return apiFetch(`/fraud/rate-breakdown${toQuery({ dimension })}`);
}

/**
 * Which fraud patterns fire together on the same claim.
 *
 * The response carries the heatmap's axis (`topPatterns`, capped at 8 and
 * ordered by trigger count *within the analysed claims*), a symmetric `matrix`
 * of cells, and `topPairs` already ranked — the notable cells are a ranking
 * decision, not something to find by scanning the grid here.
 *
 * A cell's `rate` is observed within the analysed claims; `catalogueRate` is
 * the same ratio against catalogue-wide trigger counts, which reads much lower
 * wherever those counts cover history the claims collection no longer holds.
 */
export function getPatternCooccurrence({ minCooccurrence = 2 } = {}) {
  return apiFetch(`/fraud/pattern-cooccurrence${toQuery({ minCooccurrence })}`);
}

/**
 * Paid-out cost on accepted claims, cost avoided on caught ones, and the two
 * together. Decided claims only — an open claim is neither yet.
 *
 * `potentialImpactWithoutTool` is returned by the API rather than summed here
 * on purpose: the definition of "what this would have cost" lives server-side,
 * so this client cannot drift out of step with it.
 */
export function getFinancialImpact() {
  return apiFetch("/fraud/financial-impact");
}
