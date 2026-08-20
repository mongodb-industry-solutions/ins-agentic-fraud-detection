"use client";

import styles from "./FactGrid.module.css";

/**
 * Shared label/value grid used by the Overview, Policy and Customer tabs.
 *
 * A cell is editable only if the presenter gave it an `editableKey`, which it
 * never does for anything under the claim's `fraud` sub-object — the UI does
 * not offer an affordance that the backend would reject on submit.
 */
export default function FactGrid({ cells, isEditing, drafts, onDraftChange }) {
  return (
    <div className={styles.grid}>
      {cells.map((cell) => (
        <div key={cell.id} className={styles.cell}>
          <span className={styles.label}>{cell.label}</span>
          {isEditing && cell.editableKey ? (
            <input
              className={styles.input}
              value={drafts?.[cell.editableKey] ?? cell.value}
              onChange={(event) => onDraftChange(cell.editableKey, event.target.value)}
              aria-label={cell.label}
            />
          ) : (
            <span className={`${styles.value} ${cell.isMono ? styles.mono : ""}`}>
              {cell.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
