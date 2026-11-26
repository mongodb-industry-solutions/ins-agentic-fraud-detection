import { apiFetch } from "./client";

/** Demo administration. See backend/routers/admin.py. */

/** {database}: which database a reset would wipe. */
export function getDemoResetStatus({ signal } = {}) {
  return apiFetch("/admin/reset-demo/status", { signal });
}

/**
 * Empties the demo collections and reloads the starting data (fraud patterns are untouched).
 * 409 while an assessment is in progress or a decision is being recorded.
 */
export function resetDemo() {
  return apiFetch("/admin/reset-demo", { method: "POST" });
}
