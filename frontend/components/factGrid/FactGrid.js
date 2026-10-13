"use client";

import styles from "./FactGrid.module.css";

/**
 * Shared label/value grid used by the Overview, Policy and Customer tabs.
 *
 * A cell is editable only if the presenter gave it an `editableKey`, which it
 * only does for the ten fields ClaimUpdateRequest whitelists — never anything
 * under the claim's `fraud` sub-object. The control rendered matches the
 * field's real backend type, so the PATCH carries a boolean or a number rather
 * than the string a text input would produce.
 */
function CellEditor({ cell, value, onChange }) {
  switch (cell.inputType) {
    case "boolean":
      return (
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={value === true || value === "true"}
            onChange={(event) => onChange(cell.editableKey, event.target.checked)}
          />
          {value === true || value === "true" ? "Yes" : "No"}
        </label>
      );

    case "number":
      return (
        <input
          type="number"
          className={styles.input}
          value={value}
          onChange={(event) => onChange(cell.editableKey, event.target.value)}
          aria-label={cell.label}
        />
      );

    case "select":
      return (
        <select
          className={styles.input}
          value={value}
          onChange={(event) => onChange(cell.editableKey, event.target.value)}
          aria-label={cell.label}
        >
          {(cell.selectOptions || []).map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "textarea":
      return (
        <textarea
          className={styles.textarea}
          rows={3}
          value={value}
          onChange={(event) => onChange(cell.editableKey, event.target.value)}
          aria-label={cell.label}
        />
      );

    default:
      return (
        <input
          className={styles.input}
          value={value}
          onChange={(event) => onChange(cell.editableKey, event.target.value)}
          aria-label={cell.label}
        />
      );
  }
}

export default function FactGrid({ cells, isEditing, drafts, onDraftChange }) {
  return (
    <div className={styles.grid}>
      {cells.map((cell) => {
        const isEditable = isEditing && cell.editableKey;
        const draft = drafts?.[cell.editableKey];
        const value = draft === undefined ? cell.rawValue ?? "" : draft;

        return (
          <div
            key={cell.id}
            className={`${styles.cell} ${cell.span === 3 ? styles.fullWidth : ""}`}
          >
            <span className={styles.label}>{cell.label}</span>
            {isEditable ? (
              <>
                <CellEditor cell={cell} value={value} onChange={onDraftChange} />
                {cell.hint && <span className={styles.hint}>{cell.hint}</span>}
              </>
            ) : (
              <span className={`${styles.value} ${cell.isMono ? styles.mono : ""}`}>
                {cell.value}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
