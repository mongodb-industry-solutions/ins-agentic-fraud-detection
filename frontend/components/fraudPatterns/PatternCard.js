"use client";

import Icon from "@/components/icons/Icons";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { useToast } from "@/components/shared/ToastProvider";
import styles from "./PatternCard.module.css";

export default function PatternCard({ pattern, onClick, onSetActive }) {
  const showToast = useToast();

  // The flip itself is optimistic and owned by useFraudPatterns, which also
  // rolls it back if the write fails. All this decides is what to say about it.
  const handleToggle = async (next) => {
    const writeError = await onSetActive(pattern.id, next);
    showToast(
      writeError ? (
        <>
          Couldn&apos;t {next ? "activate" : "retire"} {pattern.name}: {writeError}
        </>
      ) : (
        <>
          {pattern.name} is now {next ? "active" : "retired"}. The agent will
          {next ? " check" : " stop checking"} claims against it.
        </>
      )
    );
  };

  return (
    <div
      className={`${styles.card} ${pattern.active ? "" : styles.inactive}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(pattern.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onClick(pattern.id);
      }}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{pattern.name}</span>
        <span className={styles.weightChip}>{pattern.weightLabel}</span>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.metaItem}>
          <Icon name="bolt" size={12} />
          Triggered <span className={styles.metaValue}>{pattern.timesTriggered}</span>
        </span>
        <span className={styles.metaItem}>
          <Icon name="checkCircle" size={12} />
          Confirmed <span className={styles.metaValue}>{pattern.confirmedFraudRate}</span>
        </span>
      </div>

      <div className={styles.cardBottom}>
        {pattern.embeddingPending ? (
          <span className={styles.pendingTag}>
            <span className={styles.pdot} />
            Not available — pending embedding procedure
          </span>
        ) : (
          <span />
        )}
        <ToggleSwitch
          checked={pattern.active}
          onChange={handleToggle}
          label={`${pattern.name} active`}
        />
      </div>
    </div>
  );
}

export function AddPatternCard({ label, onClick }) {
  return (
    <button type="button" className={styles.addCard} onClick={onClick}>
      <Icon name="plus" size={13} />
      {label}
    </button>
  );
}
