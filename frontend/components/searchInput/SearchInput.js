"use client";

import Icon from "@/components/icons/Icons";
import styles from "./SearchInput.module.css";

export default function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>
        <Icon name="search" size={13} />
      </span>
      <input
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className={styles.clear} onClick={() => onChange("")} aria-label="Clear search">
          ✕
        </button>
      )}
    </div>
  );
}
