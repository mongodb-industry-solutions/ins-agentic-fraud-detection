"use client";

import styles from "./ToggleSwitch.module.css";

/**
 * Two-state switch. Stops click and key events from propagating because it is
 * used inside clickable rows and cards — without that, flipping the switch
 * would also trigger the card's own navigation underneath it.
 */
export default function ToggleSwitch({ checked, onChange, label }) {
  const flip = (event) => {
    event.stopPropagation();
    onChange(!checked);
  };

  return (
    <div
      className={`${styles.toggle} ${checked ? styles.on : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={flip}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          flip(event);
        }
      }}
    >
      <div className={styles.thumb} />
    </div>
  );
}
