"use client";

import { useCallback, useEffect, useState } from "react";

import { getAuditTrail, getClaim } from "@/lib/api/claims";
import { toFraudReportViewModel } from "@/lib/claimsPresenter";

/**
 * Loads one claim's fraud report: the claim detail (authoritative for the
 * current decision) plus the newest audit-trail entry (authoritative for the
 * analysis content). A failed load is shown as an error, never replaced
 * with sample data. The drawer is read-only: decisions are made from the Fraud
 * Assessment Queue, never here.
 */
export default function useReportDrawer(claimId) {
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

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

  return { report, isLoading, error };
}
