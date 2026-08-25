import { toFinancialBars } from "@/lib/fraudIntelligencePresenter";
import styles from "./FraudIntelligenceView.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * The business-facing headline of the tab, and the reason it sits first.
 *
 * Two bars, not three numbers in a row. Bar A and the base of Bar B are the
 * same width because they are the same figure; the extra segment on Bar B is
 * the tool's value. The reader subtracts by looking rather than working out
 * that $287,100 − $214,300 is what the tool saved.
 */
export default function FinancialImpactSection({ data, isLoading, error }) {
  const model = toFinancialBars(data);

  return (
    <Zone
      title="Financial impact"
      subtitle="What you pay today, versus what you'd be paying without fraud detection in place."
    >
      {isLoading ? (
        <Skeleton height={148} />
      ) : error ? (
        <ErrorState message={`Couldn't load financial impact data: ${error}`} />
      ) : !model ? (
        /* Reached when nothing has been decided yet, so
           potentialImpactWithoutTool is 0 and every bar would be zero-width.
           Said plainly instead of rendering two invisible bars. */
        <EmptyState message="No decided claims yet — financial impact will appear once claims have been confirmed or cleared." />
      ) : (
        <>
          <div className={styles.finBars}>
            {model.rows.map((row) => (
              <div key={row.id} className={styles.finRow}>
                <span className={styles.finLabel}>{row.label}</span>
                <div className={styles.finTrack}>
                  {row.segments.map((segment) => (
                    <span
                      key={segment.id}
                      className={`${styles.finSegment} ${styles[segment.tone]}`}
                      style={{ width: `${segment.pct}%` }}
                    />
                  ))}
                </div>
                <span className={styles.finTotal}>{row.total}</span>
              </div>
            ))}
          </div>

          <ul className={styles.finLegend}>
            <li className={styles.finLegendItem}>
              <span className={`${styles.finLegendDot} ${styles.current}`} />
              Paid on accepted claims
            </li>
            <li className={styles.finLegendItem}>
              <span className={`${styles.finLegendDot} ${styles.avoided}`} />
              Fraud cost avoided
            </li>
          </ul>

          <div className={styles.secondaryRow}>
            {model.secondary.map((stat) => (
              <div key={stat.id} className={styles.secondaryStat}>
                <span className={styles.secondaryLabel}>{stat.label}</span>
                <span className={styles.secondaryValue}>{stat.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Zone>
  );
}
