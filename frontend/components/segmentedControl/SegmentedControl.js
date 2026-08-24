"use client";

import styles from "./SegmentedControl.module.css";

/**
 * `label` names what is being segmented, because this control is now used for
 * three different things (score band, graph scope, entity type) and a screen
 * reader announcing "Fraud score band" on the entity switch would be wrong.
 *
 * A segment's `count` is optional: the entity-type switch has no count to show,
 * and rendering the badge with `undefined` inside left an empty pill floating
 * beside every label.
 */
export default function SegmentedControl({ segments, activeId, onChange, label = "Fraud score band" }) {
  return (
    <div className={styles.control} role="tablist" aria-label={label}>
      {segments.map((segment) => {
        const isActive = segment.id === activeId;
        return (
          <button
            key={segment.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.segment} ${isActive ? styles.active : ""}`}
            onClick={() => onChange(segment.id)}
          >
            {segment.label}
            {segment.count !== undefined && segment.count !== null && (
              <span className={styles.count}>{segment.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
