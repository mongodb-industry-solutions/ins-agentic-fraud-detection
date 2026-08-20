"use client";

import styles from "./SegmentedControl.module.css";

export default function SegmentedControl({ segments, activeId, onChange }) {
  return (
    <div className={styles.control} role="tablist" aria-label="Claim complexity">
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
            <span className={styles.count}>{segment.count}</span>
          </button>
        );
      })}
    </div>
  );
}
