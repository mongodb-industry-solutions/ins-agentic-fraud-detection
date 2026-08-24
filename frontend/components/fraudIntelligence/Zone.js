import styles from "./FraudIntelligenceView.module.css";

/**
 * The bordered block every section on this tab sits in, plus the three states
 * that replace its body when there is no chart to draw.
 *
 * These exist as one small set rather than per-section copies so that a loading
 * skeleton, a failed request and a genuinely empty portfolio are visually
 * distinguishable from each other everywhere on the tab. They are three
 * different facts and a reader has to be able to tell which one they are
 * looking at — an empty state where an error belongs reads as "no fraud found".
 */

export function Zone({ title, subtitle, children, label }) {
  return (
    <section className={styles.zone} aria-label={label || title}>
      <div className={styles.zoneHead}>
        <span className={styles.zoneTitle}>{title}</span>
        {subtitle && <span className={styles.zoneSubtitle}>{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

/** Shimmering block, sized to roughly what it is standing in for. */
export function Skeleton({ height = 120 }) {
  return <div className={styles.skeleton} style={{ height }} aria-hidden="true" />;
}

/**
 * A failed request, stated. Deliberately not styled as severely as the claim
 * view's Evergreen conflict banner: a request that did not come back is a
 * problem with the page, not a finding about the portfolio.
 */
export function ErrorState({ message }) {
  return <p className={styles.errorNote}>{message}</p>;
}

/** A real but empty result. Says why it is empty and what would fill it. */
export function EmptyState({ message }) {
  return <p className={styles.empty}>{message}</p>;
}
