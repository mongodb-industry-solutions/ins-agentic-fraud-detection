"use client";

import styles from "./DataTable.module.css";

/**
 * Shared bordered table zone.
 *
 * Columns are declared as view-model descriptors: `{ id, label, align, cellClass,
 * render }`. `render` receives the already-presented row, so a column can drop
 * in a shared component (StatusPill, ScoreChip, Badge) without this file
 * knowing anything about fraud state.
 */
export default function DataTable({ title, columns, rows, emptyMessage, actionLabel, onAction }) {
  return (
    <section className={`${styles.zone} ${title ? styles.titled : ""}`}>
      {title && <span className={styles.title}>{title}</span>}
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={`${styles.headerCell} ${column.align === "right" ? styles.right : ""}`}
              >
                {column.label}
              </th>
            ))}
            {actionLabel && <th className={styles.headerCell} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className={styles.empty} colSpan={columns.length + (actionLabel ? 1 : 0)}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id} className={styles.row}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={`${styles.cell} ${column.cellClass ? styles[column.cellClass] : ""} ${
                    column.align === "right" ? styles.right : ""
                  }`}
                >
                  {column.render ? column.render(row) : row[column.id]}
                </td>
              ))}
              {actionLabel && (
                <td className={styles.actionCell}>
                  <button
                    type="button"
                    className={styles.viewButton}
                    onClick={() => onAction(row.id)}
                  >
                    {actionLabel}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
