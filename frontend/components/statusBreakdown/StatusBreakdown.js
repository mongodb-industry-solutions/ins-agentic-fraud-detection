import styles from "./StatusBreakdown.module.css";

/* Segment strokes read the same CSS variables as the status pills so the two
   representations can never drift apart. */
const SEGMENT_STROKE = {
  unprocessed: "var(--border-strong)",
  flagged: "var(--evergreen)",
  cleared: "var(--spring-green)",
};

const SIZE = 144;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function StatusBreakdown({ breakdown }) {
  const { total, segments, undecided } = breakdown;

  // Three arcs drawn on one circle: each gets a dash the length of its share
  // and an offset equal to everything drawn before it.
  let consumed = 0;
  const arcs = segments.map((segment) => {
    const share = total > 0 ? segment.count / total : 0;
    const arc = { ...segment, length: share * CIRCUMFERENCE, offset: -consumed * CIRCUMFERENCE };
    consumed += share;
    return arc;
  });

  return (
    <div className={styles.panel}>
      <span className={styles.title}>Fraud status breakdown</span>
      <span className={styles.subtitle}>Every claim in the portfolio, by where it stands</span>
      <div className={styles.body}>
        <div className={styles.donutWrap}>
          <svg className={styles.donut} width={SIZE} height={SIZE} aria-hidden="true">
            {/* A faint track keeps the dark Evergreen arc legible on Slate. */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--surface-2)"
              strokeWidth={STROKE}
            />
            {arcs.map((arc) => (
              <circle
                key={arc.statusKey}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={SEGMENT_STROKE[arc.statusKey]}
                strokeWidth={STROKE}
                strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                strokeDashoffset={arc.offset}
              />
            ))}
          </svg>
          <div className={styles.center}>
            <span className={styles.total}>{total}</span>
            <span className={styles.totalCaption}>total</span>
          </div>
        </div>

        <ul className={styles.legend}>
          {segments.map((segment) => (
            <li key={segment.statusKey} className={styles.legendRow}>
              <span className={`${styles.swatch} ${styles[segment.statusKey]}`} />
              <span className={styles.legendLabel}>{segment.label}</span>
              <span className={styles.legendCount}>{segment.count}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Said rather than hidden: these claims are in the portfolio but in none
          of the three outcomes, so the ring's total would otherwise look short. */}
      {undecided > 0 && (
        <span className={styles.undecided}>
          {undecided} more {undecided === 1 ? "claim is" : "claims are"} assessed and awaiting a
          decision.
        </span>
      )}
    </div>
  );
}
