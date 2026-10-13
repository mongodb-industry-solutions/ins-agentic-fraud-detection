"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./Overlay.module.css";

/**
 * The single backdrop used by every floating layer in the app: the fraud
 * report drawer (variant="drawer", panel anchored right) and the fraud-pattern
 * modals (variant="centered", panel centred). Dark translucent layer, blur,
 * click-outside-to-close, Escape-to-close and the body-scroll lock all live
 * here once — do not reimplement any of them per screen.
 *
 * Unmounts when closed rather than sitting inert at opacity 0: callers already
 * mount conditionally, and a permanently-mounted fixed layer would swallow the
 * page's own keyboard handling.
 *
 * Rendered into <body> through a portal. Callers live inside the shell's main
 * column, which is its own stacking context (position: relative; z-index: 1),
 * so without the portal no z-index could lift the layer above a sibling column
 * — the docked Fraud Assessment Queue drew on top of the report drawer.
 */
export default function Overlay({ open, onClose, children, variant = "centered", label }) {
  // The portal target only exists in the browser, after the first render.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // The page behind the blur must not scroll under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || !isMounted) return null;

  const variantClass = variant === "drawer" ? styles.drawerVariant : styles.centeredVariant;

  return createPortal(
    <div
      className={`${styles.backdrop} ${variantClass}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // Only a click on the backdrop itself closes — a click that bubbled up
      // from inside the panel must not.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>,
    document.body
  );
}
