"use client";

import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";
import styles from "./ClaimsTable.module.css";

export default function ClaimsTable({
  rows,
  showCheckboxes,
  selectedIds,
  onToggleRow,
  onViewDetails,
  onAnalyze,
  onViewReport,
}) {
  return (
    <section className={styles.zone} aria-label="Claims">
      <table className={styles.table}>
        <thead>
          <tr>
            {showCheckboxes && <th className={`${styles.headerCell} ${styles.checkboxCell}`} />}
            <th className={styles.headerCell}>Claim</th>
            <th className={styles.headerCell}>Customer</th>
            <th className={styles.headerCell}>Coverage</th>
            <th className={styles.headerCell}>Opened</th>
            {/* Named explicitly: this column is the fraud review state, not
                the claim's open/closed lifecycle. */}
            <th className={styles.headerCell}>Fraud status</th>
            <th className={styles.headerCell}>Score</th>
            <th className={styles.headerCell} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className={styles.empty} colSpan={showCheckboxes ? 8 : 7}>
                No claims match the current filters.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id} className={styles.row} data-seg={row.segment}>
              {showCheckboxes && (
                <td className={`${styles.cell} ${styles.checkboxCell}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => onToggleRow(row.id)}
                    aria-label={`Select ${row.claimId}`}
                  />
                </td>
              )}
              <td className={`${styles.cell} ${styles.mono}`}>{row.claimId}</td>
              <td className={styles.cell}>
                <span className={styles.customer}>
                  <span className={styles.customerName}>{row.customerName}</span>
                  <span className={styles.customerSub}>{row.customerSubline}</span>
                </span>
              </td>
              <td className={styles.cell}>{row.coverage}</td>
              <td className={`${styles.cell} ${styles.date}`}>{row.openedLabel}</td>
              <td className={styles.cell}>
                <StatusPill statusKey={row.statusKey} label={row.statusLabel} />
              </td>
              <td className={styles.cell}>
                <ScoreChip value={row.scoreLabel} />
              </td>
              <td className={styles.cell}>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.outlineButton}
                    onClick={() => onViewDetails?.(row.claimId)}
                  >
                    View details
                  </button>
                  {row.isUnprocessed ? (
                    <button
                      type="button"
                      className={styles.solidButton}
                      onClick={() => onAnalyze?.(row.claimId)}
                    >
                      Analyze for fraud
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.outlineButton}
                      onClick={() => onViewReport?.(row.claimId)}
                    >
                      View report
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
