"use client";

import { useMemo, useState } from "react";

import FilterMenu from "@/components/filterMenu/FilterMenu";
import Icon from "@/components/icons/Icons";
import PageHeader from "@/components/pageHeader/PageHeader";
import { useToast } from "@/components/shared/ToastProvider";
import { sortPatterns, toPatternSortControl } from "@/lib/fraudPatternsPresenter";
import AddPatternModal from "./AddPatternModal";
import AddRuleModal from "./AddRuleModal";
import PatternCard, { AddPatternCard } from "./PatternCard";
import PatternDetailModal from "./PatternDetailModal";
import styles from "./FraudPatternsView.module.css";
import useFraudPatterns from "./useFraudPatterns";

function InfoBanner({ onDismiss }) {
  return (
    <div className={styles.banner}>
      <Icon name="info" size={16} className={styles.bannerIcon} />
      <span>
        This is where your team explores and maintains the ruleset the fraud-detection agent checks
        every claim against. <span className={styles.bannerTerm}>Constraint-based rules</span> are
        deterministic field comparisons (e.g. &ldquo;claim opened within 15 days of policy
        inception&rdquo;). <span className={styles.bannerTerm}>Description-based patterns</span> are
        softer signals matched by narrative similarity to past claims. Both contribute points to a
        claim&apos;s fraud score the same way.
      </span>
      <button type="button" className={styles.bannerClose} onClick={onDismiss} aria-label="Dismiss">
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

function PatternColumn({ title, patterns, addLabel, onCardClick, onAddClick, onSetActive }) {
  const [sort, setSort] = useState("triggered");
  const sortControl = useMemo(() => toPatternSortControl(sort), [sort]);
  // Sorted here rather than refetching: the whole catalogue is already loaded.
  const sorted = useMemo(() => sortPatterns(patterns, sort), [patterns, sort]);

  return (
    <section>
      <div className={styles.colHeader}>
        <div className={styles.colHeaderLeft}>
          <span className={styles.colTitle}>{title}</span>
          <span className={styles.colCount}>{patterns.length}</span>
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
  // Session-only: dismissing the primer is not worth persisting.
  const [isBannerVisible, setIsBannerVisible] = useState(true);
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

      {isBannerVisible && <InfoBanner onDismiss={() => setIsBannerVisible(false)} />}

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
            patterns={rules}
            addLabel="Add new rule"
            onCardClick={setDetailPatternId}
            onAddClick={() => setIsAddRuleOpen(true)}
            onSetActive={setActive}
          />
          <PatternColumn
            title="Description-based patterns"
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
