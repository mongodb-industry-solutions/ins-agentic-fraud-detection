"use client";

import Icon from "@/components/icons/Icons";
import { useToast } from "@/components/shared/ToastProvider";
import { PATTERN_TYPE } from "@/lib/fraudPatternsPresenter";
import styles from "./PatternCard.module.css";

export default function PatternCard({ pattern, onClick, onSetActive }) {
  const showToast = useToast();
  const isRule = pattern.patternType === PATTERN_TYPE.RULE;

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
        <span className={styles.typeChip} title={pattern.typeLabel}>
          <Icon name={isRule ? "flag" : "sparkle"} size={14} />
        </span>
        <div className={styles.titleBlock}>
          <span className={styles.cardName}>{pattern.name}</span>
          <span className={styles.cardType}>{pattern.typeLabel}</span>
        </div>
        <span className={styles.weightChip} title="Points added to a claim's fraud score">
          {pattern.weightLabel}
        </span>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.metaItem}>
          <Icon name="bolt" size={12} />
          Triggered <span className={styles.metaValue}>{pattern.timesTriggered}</span>
        </span>
        <span className={styles.metaItem}>
          <Icon name="checkCircle" size={12} />
          Confirmed <span className={styles.metaValue}>{pattern.confirmedCount}</span>
        </span>
      </div>

      <div className={styles.cardBottom}>
        {pattern.embeddingPending ? (
          <span className={styles.pendingTag}>
            <span className={styles.pdot} />
            Not available — pending embedding procedure
          </span>
        ) : (
          <span className={pattern.active ? styles.statusOn : styles.statusOff}>
            {pattern.active ? "Active" : "Retired"}
          </span>
        )}
        {/* A labelled action rather than a bare switch: it says what a click
            will do. Click and key events are stopped so pressing it does not
            also open the card underneath. */}
        <button
          type="button"
          className={pattern.active ? styles.deactivateButton : styles.activateButton}
          onClick={(event) => {
            event.stopPropagation();
            handleToggle(!pattern.active);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={`${pattern.active ? "Deactivate" : "Activate"} ${pattern.name}`}
        >
          {pattern.active ? "Deactivate" : "Activate"}
        </button>
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
