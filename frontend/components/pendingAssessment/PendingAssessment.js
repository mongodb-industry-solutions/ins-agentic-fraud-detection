"use client";

import AnalyzeButton from "@/components/assessmentQueue/AnalyzeButton";
import styles from "./PendingAssessment.module.css";

/**
 * Claims nobody has analysed yet — the agent's backlog, as opposed to the
 * table below, which lists claims it has already assessed. Each row's action
 * runs the assessment (or reflects that it is already queued or running).
 */
export default function PendingAssessment({ rows, onAnalyze, onViewDetails }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.pulseDot} />
          <span className={styles.title}>Pending assessment</span>
        </div>
        <span className={styles.count}>{rows.length}</span>
      </div>
      <p className={styles.caption}>
        {rows.length === 0
          ? "Every claim in the portfolio has been analyzed."
          : "Claims the agent has not analyzed yet."}
      </p>

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <button
                type="button"
                className={styles.info}
                onClick={() => onViewDetails?.(row.claimId)}
                title="View claim details"
              >
                <span className={styles.infoTop}>
                  <span className={styles.customer}>{row.customerName}</span>
                  <span className={styles.claimId}>{row.claimId}</span>
                </span>
                <span className={styles.detail}>
                  {row.coverage} · opened <span className={styles.mono}>{row.openedLabel}</span>
                </span>
              </button>
              <AnalyzeButton
                claimId={row.claimId}
                className={styles.analyzeButton}
                onAnalyze={onAnalyze}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
