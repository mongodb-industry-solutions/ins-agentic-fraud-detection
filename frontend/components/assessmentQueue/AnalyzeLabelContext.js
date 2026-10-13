"use client";

import { createContext, useContext } from "react";

import { QUEUE_STATUS } from "./useAssessmentQueue";

/**
 * What every "Analyze for fraud" button needs to know about the Fraud
 * Assessment Queue, provided once in page.js: each claim's queue status, and
 * whether the agent is busy with another claim.
 */
const AnalyzeLabelContext = createContext({ statusByClaim: new Map(), isBusy: false });

export const AnalyzeLabelProvider = AnalyzeLabelContext.Provider;

/**
 * The label for a claim's Analyze button:
 *   its claim is being assessed     -> "Processing"
 *   its claim is waiting in queue   -> "Waiting to be processed"
 *   the agent is busy with another  -> "Add to queue"
 *   the agent is free               -> `idleLabel` (the run starts at once)
 */
export function useAnalyzeLabel(claimId, idleLabel = "Analyze for fraud") {
  const { statusByClaim, isBusy } = useContext(AnalyzeLabelContext);
  const status = statusByClaim.get(claimId);
  if (status === QUEUE_STATUS.PROCESSING) return { label: "Processing", status };
  if (status === QUEUE_STATUS.WAITING) return { label: "Waiting to be processed", status };
  if (isBusy) return { label: "Add to queue", status: null };
  return { label: idleLabel, status: null };
}
