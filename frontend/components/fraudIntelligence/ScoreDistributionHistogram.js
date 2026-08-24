import { toHistogramBars, toHistogramLegend } from "@/lib/fraudIntelligencePresenter";
import styles from "./FraudIntelligenceView.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/** Band -> bar colour. The band itself is always the backend's, never derived here. */
const BAND_CLASS = {
  LOW: "bandLow",
  REVIEW: "bandReview",
  HIGH: "bandHigh",
};

/**
 * Every processed claim, one bar per exact score 0..12.
 *
 * Bar colour comes from `bucket.band` as sent by the API. No thresholds are
 * held on this side at all, which is what guarantees a score of 8 is the same
 * colour here as it is on a fraud report — both read one server-side band
 * assignment rather than two threshold tables that could drift apart.
 *
 * Heights are relative to the tallest bucket, so the chart stays readable
 * whether the portfolio holds fourteen claims or fourteen thousand.
 */
export default function ScoreDistributionHistogram({ distribution, isLoading, error }) {
  const model = toHistogramBars(distribution);
  const legend = toHistogramLegend(distribution);

  return (
    <Zone
      title="Score distribution"
      subtitle="Every processed claim, grouped by computed fraud score. Bar colour follows the band the backend assigns."
    >
      {isLoading ? (
        <Skeleton height={168} />
      ) : error ? (
        <ErrorState message={`Couldn't load the score distribution: ${error}`} />
      ) : !model ? (
        <EmptyState message="No scored claims yet — the distribution will populate once claims have been analyzed." />
      ) : (
        <>
          <div className={styles.histWrap}>
            {model.bars.map((bar) => (
              <div key={bar.score} className={styles.histCol}>
                {/* The count sits above its own bar rather than on a Y axis:
                    thirteen short bars are read by value, not by height. */}
                <span className={styles.histCount}>{bar.count > 0 ? bar.count : ""}</span>
                <div className={styles.histTrack}>
                  <div
                    className={`${styles.histBar} ${styles[BAND_CLASS[bar.band]] || ""}`}
                    style={{ height: `${bar.heightPct}%` }}
                    // A zero-count score still occupies a column, so the axis
                    // keeps its spacing — the title says so for a screen reader.
                    title={`Score ${bar.score}: ${bar.count} claim(s), ${bar.band} band`}
                  />
                </div>
                <span className={styles.histLabel}>{bar.score}</span>
              </div>
            ))}
          </div>

          <ul className={styles.histLegend}>
            {legend.map((entry) => (
              <li key={entry.band} className={styles.finLegendItem}>
                <span
                  className={`${styles.finLegendDot} ${styles[BAND_CLASS[entry.band]] || ""}`}
                />
                {entry.label} band
              </li>
            ))}
            <li className={styles.histTotal}>{model.total} scored</li>
          </ul>
        </>
      )}
    </Zone>
  );
}
