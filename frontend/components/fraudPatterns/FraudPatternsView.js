"use client";

import { useMemo, useState } from "react";

import FilterMenu from "@/components/filterMenu/FilterMenu";
import Icon from "@/components/icons/Icons";
import PageHeader from "@/components/pageHeader/PageHeader";
import { useToast } from "@/components/shared/ToastProvider";
import { sortPatterns, toCatalogueSummary, toPatternSortControl } from "@/lib/fraudPatternsPresenter";
import AddPatternModal from "./AddPatternModal";
import AddRuleModal from "./AddRuleModal";
import PatternCard, { AddPatternCard } from "./PatternCard";
import PatternDetailModal from "./PatternDetailModal";
import styles from "./FraudPatternsView.module.css";
import useFraudPatterns from "./useFraudPatterns";

/** The catalogue at a glance. Every figure is counted from the loaded patterns. */
function CatalogueSummary({ summary }) {
  const cells = [
    {
      id: "active",
      icon: "check",
      label: "Active patterns",
      value: `${summary.active}`,
      note: `of ${summary.total} in the catalogue`,
    },
    {
      id: "mix",
      icon: "grid",
      label: "Rules · Descriptions",
      value: `${summary.rules} · ${summary.patterns}`,
      note: "constraint-based · similarity",
    },
    {
      id: "triggers",
      icon: "bolt",
      label: "Total triggers",
      value: `${summary.triggered}`,
      note: `${summary.confirmed} confirmed as fraud`,
    },
    {
      id: "reliable",
      icon: "shield",
      label: "Most reliable",
      value: summary.mostReliable?.rateLabel ?? "—",
      note: summary.mostReliable?.name ?? "No pattern has triggered yet",
    },
  ];

  return (
    <section className={styles.summary} aria-label="Pattern catalogue summary">
      {cells.map((cell) => (
        <div key={cell.id} className={`${styles.summaryCell} ${styles[`tone-${cell.id}`]}`}>
          <span className={styles.summaryChip}>
            <Icon name={cell.icon} size={15} />
          </span>
          <div className={styles.summaryText}>
            <span className={styles.summaryLabel}>{cell.label}</span>
            <span className={styles.summaryValue}>{cell.value}</span>
            <span className={styles.summaryNote}>{cell.note}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function PatternColumn({
  title,
  description,
  icon,
  patterns,
  addLabel,
  onCardClick,
  onAddClick,
  onSetActive,
}) {
  const [sort, setSort] = useState("triggered");
  const sortControl = useMemo(() => toPatternSortControl(sort), [sort]);
  // Sorted here rather than refetching: the whole catalogue is already loaded.
  const sorted = useMemo(() => sortPatterns(patterns, sort), [patterns, sort]);

  return (
    <section>
      <div className={styles.colHeader}>
        <div className={styles.colHeaderLeft}>
          <span className={styles.colIcon}>
            <Icon name={icon} size={14} />
          </span>
          <div className={styles.colHeading}>
            <div className={styles.colTitleRow}>
              <span className={styles.colTitle}>{title}</span>
              <span className={styles.colCount}>{patterns.length}</span>
            </div>
            <span className={styles.colDescription}>{description}</span>
          </div>
        </div>
        <FilterMenu
          control={sortControl}
          icon="sortDesc"
          align="right"
          onSelect={(_, optionId) => setSort(optionId)}
        />
      </div>

      {sorted.map((pattern) => (
        <PatternCard
          key={pattern.id}
          pattern={pattern}
          onClick={onCardClick}
          onSetActive={onSetActive}
        />
      ))}

      <AddPatternCard label={addLabel} onClick={onAddClick} />
    </section>
  );
}

/**
 * The pattern catalogue: constraint-based rules on the left, description-based
 * similarity patterns on the right. Read-only against the backend — every write
 * control is a labelled placeholder, because the fraud-patterns router has no
 * write endpoint yet.
 */
export default function FraudPatternsView({ onOpenClaim }) {
  const { rules, patterns, isLoading, error, setActive, applyUpdate, addPattern } =
    useFraudPatterns();
  const showToast = useToast();
  const [detailPatternId, setDetailPatternId] = useState(null);
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);
  const [isAddPatternOpen, setIsAddPatternOpen] = useState(false);

  /**
   * `embedding` is the result of the embed call the similarity form makes after
   * creating — null for rules, which are never embedded.
   */
  const handleCreated = (newPattern, response, embedding) => {
    const didEmbed = embedding?.embedded === true;
    // The create response necessarily says hasEmbedding: false — the vector did
    // not exist yet when it was written. Patched here so the new card reads
    // "ready" instead of contradicting the embedding that just succeeded.
    addPattern(didEmbed ? { ...newPattern, hasEmbedding: true } : newPattern);

    setIsAddRuleOpen(false);
    setIsAddPatternOpen(false);

    if (embedding?.error) {
      showToast(
        <>
          Created {newPattern.patternId}, but embedding failed: {embedding.error} The pattern is
          saved and stays pending until it has been embedded.
        </>
      );
      return;
    }

    showToast(
      <>
        Created {newPattern.patternId} — {newPattern.name}.
        {didEmbed && ` Embedded with ${embedding.model} (${embedding.dimensions} dimensions).`}
        {!didEmbed &&
          response.embeddingPending &&
          " It won't take part in similarity matching until its embedding has been generated."}
      </>
    );
  };

  const total = rules.length + patterns.length;
  const activeCount = [...rules, ...patterns].filter((pattern) => pattern.active).length;
  const summary = useMemo(() => toCatalogueSummary(rules, patterns), [rules, patterns]);

  return (
    <main className={styles.content}>
      <PageHeader
        title="Fraud Patterns"
        subtitle={
          isLoading
            ? "Loading the pattern catalogue…"
            : `${activeCount} active patterns of ${total} across 2 rule types`
        }
      />

      {!isLoading && !error && total > 0 && <CatalogueSummary summary={summary} />}

      {/* Stated plainly rather than backfilled with fixture patterns: an empty
          catalogue is honest, a plausible fake one is not. */}
      {error && <div className={styles.errorNote}>Couldn&apos;t load the patterns: {error}</div>}

      {isLoading ? (
        <div className={styles.columns}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : (
        <div className={styles.columns}>
          <PatternColumn
            title="Constraint-based rules"
            description="Exact checks on claim fields, such as amounts, dates and report delays, against fixed thresholds. Each match adds points to the fraud score."
            icon="flag"
            patterns={rules}
            addLabel="Add new rule"
            onCardClick={setDetailPatternId}
            onAddClick={() => setIsAddRuleOpen(true)}
            onSetActive={setActive}
          />
          <PatternColumn
            title="Description-based patterns"
            description="Softer signals described in plain language. The agent compares each claim narrative to the description and adds points when they read alike."
            icon="sparkle"
            patterns={patterns}
            addLabel="Add new pattern"
            onCardClick={setDetailPatternId}
            onAddClick={() => setIsAddPatternOpen(true)}
            onSetActive={setActive}
          />
        </div>
      )}

      <PatternDetailModal
        patternId={detailPatternId}
        open={Boolean(detailPatternId)}
        onClose={() => setDetailPatternId(null)}
        onOpenClaim={onOpenClaim}
        onPatternUpdated={applyUpdate}
      />
      {/* Mounted only while open, so Cancel genuinely discards the form rather
          than leaving half-filled fields waiting behind a closed modal. */}
      {isAddRuleOpen && (
        <AddRuleModal
          open
          onClose={() => setIsAddRuleOpen(false)}
          onCreated={handleCreated}
        />
      )}
      {isAddPatternOpen && (
        <AddPatternModal
          open
          onClose={() => setIsAddPatternOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </main>
  );
}
