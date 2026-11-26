"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./DemoReset.module.css";

/** Full-screen greyed layer shown while the reset runs. Blocks every click beneath it. */
export default function ResetLoading() {
  // Portalled to <body>: the topbar sits in a stacking context that would
  // otherwise keep this layer from covering the sidebar and the queue panel.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!isMounted) return null;
  return createPortal(
    <div className={styles.loading} role="alertdialog" aria-modal="true" aria-busy="true" aria-label="Resetting demo data">
      <div className={styles.spinner} aria-hidden="true" />
      <p className={styles.loadingTitle}>Resetting demo data…</p>
      <p className={styles.loadingHint}>Please wait, this only takes a moment.</p>
    </div>,
    document.body
  );
}
