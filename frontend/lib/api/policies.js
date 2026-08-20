import { apiFetch, toQuery } from "./client";

/** Mirrors backend/routers/policies.py. */

export function listPolicies({
  search,
  status = "ALL",
  coverageType = "ALL",
  page = 1,
  limit = 25,
  sort,
} = {}) {
  return apiFetch(`/policies${toQuery({ search, status, coverageType, page, limit, sort })}`);
}

export function getPolicy(policyId) {
  return apiFetch(`/policies/${policyId}`);
}
