"use client";

import { useCallback, useEffect, useState } from "react";

import { getAuditTrail, getClaim, submitFraudDecision } from "@/lib/api/claims";
import { STATUS, toFraudReportViewModel } from "@/lib/claimsPresenter";
import { toDemoReport } from "@/lib/const/demoReports";
import { PROFILE } from "@/lib/const/nav";

/**
 * Loads one claim's fraud report: the claim detail (authoritative for the
 * current decision) plus the newest audit-trail entry (authoritative for the
 * analysis content). Falls back to the canned report when no backend is
 * reachable, so the drawer is demoable standalone.
 */
export default function useReportDrawer(claimId, row) {
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(
    async (signal) => {
      setIsLoading(true);
      setError(null);
      // Cleared rather than kept: showing the previous claim's score and
      // patterns under this claim's id would misrepresent a different claim's
      // report as this one's, even briefly.
      setReport(null);

      try {
        const [claim, audit] = await Promise.all([getClaim(claimId), getAuditTrail(claimId)]);
        if (signal?.aborted) return;
        setReport(toFraudReportViewModel(claim, audit?.records?.[0]));
      } catch (fetchError) {
        if (signal?.aborted) return;
        const demo = toDemoReport(claimId, row);
        if (demo) {
          setReport(toFraudReportViewModel(demo.claim, demo.review));
        } else {
          setError(fetchError.message);
        }
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [claimId, row]
  );

  useEffect(() => {
    if (!claimId) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [claimId, load]);

  /**
   * A dismissal always carries a reason — the backend rejects one without it,
   * so the caller is expected to have gated on a non-empty field already.
   */
  const decide = useCallback(
    async (decision, dismissReason) => {
      setIsSubmitting(true);
      try {
        await submitFraudDecision(claimId, {
          decision,
          reviewedBy: PROFILE.name,
          dismissReason: decision === "DISMISSED" ? dismissReason : undefined,
        });
        await load();
      } catch {
        // No backend in demo mode: apply the decision locally so the section
        // still reflects the new state without a close/reopen.
        setReport((current) =>
          current
            ? {
                ...current,
                statusKey: decision === "CONFIRMED_FRAUD" ? STATUS.FLAGGED : STATUS.CLEARED,
                decision: {
                  state: decision === "CONFIRMED_FRAUD" ? "confirmed" : "dismissed",
                  reviewedBy: PROFILE.name,
                  reviewedAtLabel: "JUST NOW",
                  dismissReason: decision === "DISMISSED" ? dismissReason : null,
                },
              }
            : current
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [claimId, load]
  );

  return { report, isLoading, error, isSubmitting, decide };
}
