"use client";

import styles from "./BulkActionBar.module.css";

export default function BulkActionBar({ selectedCount, onProcessBatch }) {
  return (
    <div className={`${styles.bar} ${selectedCount > 0 ? styles.visible : ""}`}>
      <span className={styles.count}>{selectedCount} selected</span>
      <button type="button" className={styles.button} onClick={onProcessBatch}>
        Process batch
      </button>
    </div>
  );
}
