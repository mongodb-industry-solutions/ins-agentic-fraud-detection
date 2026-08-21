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

export function getRelationshipGraph({ scope = "ALL", limit = 60 } = {}) {
  return apiFetch(`/fraud/relationship-graph${toQuery({ scope, limit })}`);
}
