import { apiFetch } from "./client";

/** The Fraud Assessment Queue, run by the backend. See backend/routers/assessment_queue.py. */

export function listAssessmentQueue({ signal } = {}) {
  return apiFetch("/assessment-queue", { signal });
}

/** 409 when the claim is already in the queue; the existing job is in `details.job`. */
export function enqueueAssessment(claimId, requestedBy) {
  return apiFetch("/assessment-queue", { method: "POST", body: { claimId, requestedBy } });
}

export function getAssessmentJob(jobId, { signal } = {}) {
  return apiFetch(`/assessment-queue/${encodeURIComponent(jobId)}`, { signal });
}

/** Only while the job is still waiting to be processed (or to dismiss a failure). */
export function removeAssessmentJob(jobId) {
  return apiFetch(`/assessment-queue/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

/**
 * Hands the reviewer's decision to the backend, which has the agent record it
 * on the job's session in the background. Returns at once (202); the job's
 * `decisionStatus` then goes RECORDING -> DECIDED (or FAILED).
 */
export function recordAssessmentDecision(jobId, { decision, reviewedBy, reason, siuReferred }) {
  return apiFetch(`/assessment-queue/${encodeURIComponent(jobId)}/decision`, {
    method: "POST",
    body: { decision, reviewedBy, reason, siuReferred: Boolean(siuReferred) },
  });
}
