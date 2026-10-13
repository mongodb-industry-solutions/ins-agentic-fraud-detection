"use client";

import { useEffect } from "react";

import styles from "./ConfirmDialog.module.css";

/** A small yes/no question over the page. Escape or the backdrop cancels. */
export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <>
      <div className={styles.backdrop} onClick={onCancel} />
      <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={styles.title}>{title}</div>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={styles.confirm} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
