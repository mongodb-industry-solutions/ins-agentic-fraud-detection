import { apiFetch, toQuery } from "./client";

/** One file per backend domain. Mirrors backend/routers/claims.py. */

export function listClaims({ complexity = "ALL", status = "ALL", page = 1, limit = 25, sort = "-claimDate" } = {}) {
  return apiFetch(`/claims${toQuery({ complexity, status, page, limit, sort })}`);
}

export function getClaim(claimId) {
  return apiFetch(`/claims/${claimId}`);
}

/** Fraud-review history, newest first — one document per agent run. */
export function getAuditTrail(claimId) {
  return apiFetch(`/claims/${claimId}/audit`);
}

export function getLinkedClaims(claimId) {
  return apiFetch(`/claims/${claimId}/linked`);
}

export function selectBatch(claimIds) {
  return apiFetch("/claims/batch/select", { method: "POST", body: { claimIds } });
}

export function submitFraudDecision(claimId, { decision, reviewedBy, dismissReason }) {
  return apiFetch(`/claims/${claimId}/fraud-decision`, {
    method: "POST",
    body: { decision, reviewedBy, dismissReason },
  });
}
