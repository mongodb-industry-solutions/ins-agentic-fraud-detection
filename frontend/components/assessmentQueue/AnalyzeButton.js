"use client";

import { useAnalyzeLabel } from "./AnalyzeLabelContext";
import styles from "./AnalyzeButton.module.css";
import { QUEUE_STATUS } from "./useAssessmentQueue";

const TITLE = {
  [QUEUE_STATUS.PROCESSING]: "The agent is assessing this claim — open it",
  [QUEUE_STATUS.WAITING]: "This claim is in the Fraud Assessment Queue",
};

/**
 * Every "Analyze for fraud" button. Its label follows the Fraud Assessment
 * Queue (see useAnalyzeLabel); the click is always the same `onAnalyze`, which
 * page.js resolves into open / queue / start.
 */
export default function AnalyzeButton({ claimId, className, idleLabel, icon, onAnalyze }) {
  const { label, status } = useAnalyzeLabel(claimId, idleLabel);
  return (
    <button
      type="button"
      className={`${className || ""} ${status ? styles.inQueue : ""}`}
      onClick={() => onAnalyze?.(claimId)}
      title={TITLE[status]}
    >
      {status === QUEUE_STATUS.PROCESSING ? <span className={styles.spinner} /> : icon}
      {label}
    </button>
  );
}
