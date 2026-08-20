"use client";

import Icon from "@/components/icons/Icons";
import styles from "./BackLink.module.css";

export default function BackLink({ label, onClick }) {
  return (
    <button type="button" className={styles.back} onClick={onClick}>
      <span className={styles.chevronLeft}>
        <Icon name="chevronDown" size={12} />
      </span>
      {label}
    </button>
  );
}
