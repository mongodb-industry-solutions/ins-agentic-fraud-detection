import { apiFetch, toQuery } from "./client";

/** Mirrors backend/routers/fraud.py. */

export function getPortfolioStats({ dateFrom, dateTo, bucket = "week" } = {}) {
  return apiFetch(`/fraud/portfolio-stats${toQuery({ dateFrom, dateTo, bucket })}`);
}

export function getRecentActivity({ limit = 20 } = {}) {
  return apiFetch(`/fraud/recent-activity${toQuery({ limit })}`);
}

export function getRelationshipGraph({ scope = "ALL", limit = 60 } = {}) {
  return apiFetch(`/fraud/relationship-graph${toQuery({ scope, limit })}`);
}
