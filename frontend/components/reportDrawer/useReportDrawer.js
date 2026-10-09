"use client";

import { useCallback, useEffect, useState } from "react";

import { streamClaimDecision } from "@/lib/api/agentChat";
import { getAuditTrail, getClaim } from "@/lib/api/claims";
import { toFraudReportViewModel } from "@/lib/claimsPresenter";
import { PROFILE } from "@/lib/const/nav";
import { getOrCreateUserId } from "@/lib/userIdentity";

/**
 * Loads one claim's fraud report: the claim detail (authoritative for the
 * current decision) plus the newest audit-trail entry (authoritative for the
 * analysis content). A failed load is shown as an error, never replaced
 * with sample data.
 */
export default function useReportDrawer(claimId) {
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
        setError(fetchError.message || "Could not load this report.");
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [claimId]
  );

  useEffect(() => {
    if (!claimId) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [claimId, load]);

  const [decisionError, setDecisionError] = useState(null);

  /**
   * The agent is the only writer of fraud state, so the verdict goes to the
   * agent (no session needed: the assessment trace is already persisted) and
   * the report is reloaded from MongoDB to show what actually landed.
   *
   * A dismissal always carries a reason — the backend rejects one without it,
   * so the caller is expected to have gated on a non-empty field already.
   */
  const decide = useCallback(
    async (decision, dismissReason) => {
      setIsSubmitting(true);
      setDecisionError(null);
      try {
        let streamError = null;
        await streamClaimDecision(
          {
            claimId,
            decision,
            reviewedBy: PROFILE.name,
            dismissReason: decision === "DISMISSED" ? dismissReason : undefined,
            userId: getOrCreateUserId(),
          },
          { onStreamError: (reason) => (streamError = reason) }
        );
        if (streamError) throw new Error(streamError);
        await load();
      } catch (submitError) {
        setDecisionError(submitError.message || "The agent could not record the decision.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [claimId, load]
  );

  return { report, isLoading, error, decisionError, isSubmitting, decide };
}
