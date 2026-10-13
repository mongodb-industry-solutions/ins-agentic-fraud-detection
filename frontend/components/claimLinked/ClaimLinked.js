"use client";

import Icon from "@/components/icons/Icons";
import StatusPill from "@/components/statusPill/StatusPill";
import styles from "./ClaimLinked.module.css";

function LinkedRow({ linked, number, onOpenClaim }) {
  return (
    <div className={styles.row}>
      <span className={styles.numberChip}>{number}</span>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.customer}>{linked.customerName}</span>
          <span className={styles.claimId}>{linked.claimId}</span>
          {linked.semantic?.similarityLabel && (
            <span className={styles.matchBadge}>{linked.semantic.similarityLabel}</span>
          )}
          {linked.semantic?.citedByAgent && (
            <span className={styles.citedBadge}>Cited by agent</span>
          )}
        </div>
        {linked.reasons.map((reason) => (
          <span key={reason.text} className={styles.reason}>
            <span className={styles.reasonIcon}>
              <Icon name={reason.icon} size={12} />
            </span>
            {reason.text}
          </span>
        ))}
      </div>
      {linked.semantic?.outcomeKey && (
        <span className={styles.outcome}>
          <StatusPill statusKey={linked.semantic.outcomeKey} />
        </span>
      )}
      {/* The recursive entry point: claim view leads to claim view, using
          the same drilling mechanism as every other entry. */}
      <button
        type="button"
        className={styles.viewButton}
        onClick={() => onOpenClaim(linked.claimId)}
      >
        View
      </button>
    </div>
  );
}

function LinkedSection({ title, description, tone, rows, onOpenClaim }) {
  if (rows.length === 0) return null;
  return (
    <section className={`${styles.section} ${styles[tone]}`} aria-label={title}>
      <header className={styles.sectionHeader}>
        <div className={styles.sectionTitleRow}>
          <h3 className={styles.sectionTitle}>{title}</h3>
          <span className={styles.sectionCount}>{rows.length}</span>
        </div>
        <p className={styles.sectionDescription}>{description}</p>
      </header>
      {rows.map((linked, index) => (
        <LinkedRow key={linked.id} linked={linked} number={index + 1} onOpenClaim={onOpenClaim} />
      ))}
    </section>
  );
}

/**
 * Two groups, because the links mean different things: a semantic match is the
 * agent's judgement that the narratives read alike, while a field-based link is
 * a plain fact (same customer, shop or pattern). A claim found both ways sits in
 * the semantic group, where it carries both kinds of reason.
 */
export default function ClaimLinked({ linkedClaims, onOpenClaim }) {
  if (linkedClaims.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No related claims found for this claim.</p>
      </div>
    );
  }

  const semantic = linkedClaims.filter((linked) => linked.semantic);
  const fieldBased = linkedClaims.filter((linked) => !linked.semantic);

  return (
    <div className={styles.sections}>
      <LinkedSection
        title="Semantically linked claims"
        description="Identified by the agent in its assessment: claims whose narrative reads like this one."
        tone="semantic"
        rows={semantic}
        onOpenClaim={onOpenClaim}
      />
      <LinkedSection
        title="Linked by claim details"
        description="Share a customer, repair shop or fraud pattern with this claim."
        tone="fieldBased"
        rows={fieldBased}
        onOpenClaim={onOpenClaim}
      />
    </div>
  );
}
