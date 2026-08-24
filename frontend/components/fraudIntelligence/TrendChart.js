import { formatWindow, toTrendChart } from "@/lib/fraudIntelligencePresenter";
import styles from "./FraudIntelligenceView.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * Four claim-outcome counts over time, one polyline each.
 *
 * This is the one chart in the app permitted the reserved graph-only colours
 * (Chartreuse, Lime, Sky, Clear Blue). That is legitimate here and nowhere else
 * on this tab: none of these four lines has a corresponding status pill it needs
 * to visually match, unlike the status donut, which mirrors the pills exactly
 * and must stay on the core seven-colour palette. The colours are applied as
 * `--chart-*` tokens from globals.css, where the same exception is documented —
 * they are not raw hex literals, and they are not an oversight.
 *
 * Every coordinate is computed from the data (see toTrendChart): the Y scale is
 * 0..max-observed and the X positions come from each bucket's real timestamp, so
 * a quiet fortnight renders as a genuine gap. A flat portfolio draws a flat line
 * rather than being given artificial variance to look more like a chart.
 *
 * NOTE: date-range filtering (dateFrom/dateTo as a user-facing control) and
 * tracking a metric's own evolution over time both need the time-series
 * collection — Tool currently in development. The window shown here is the
 * backend's trailing default, anchored to the newest claim in the portfolio and
 * stated in the caption so it is never ambiguous which period is on screen.
 */
export default function TrendChart({ trend, dateFrom, dateTo, bucket, isLoading, error }) {
  const model = toTrendChart(trend);
  const window = formatWindow(dateFrom, dateTo);

  return (
    <Zone
      title="Trend over time"
      subtitle={
        window
          ? `Claim outcomes by ${bucket || "week"}, ${window}.`
          : "Claim outcomes over the reporting window."
      }
    >
      {isLoading ? (
        <Skeleton height={190} />
      ) : error ? (
        <ErrorState message={`Couldn't load the trend: ${error}`} />
      ) : !model ? (
        <EmptyState message="Not enough claim activity in this period to plot a trend — at least two time buckets are needed." />
      ) : (
        <>
          <ul className={styles.trendLegend}>
            {model.series.map((series) => (
              <li key={series.id} className={styles.trendLegendItem}>
                <span className={`${styles.trendSwatch} ${styles[series.tone]}`} />
                <span className={styles.trendLegendLabel}>{series.label}</span>
                <span className={styles.trendLegendCount}>{series.total}</span>
              </li>
            ))}
          </ul>

          <div className={styles.trendPlot}>
            <svg
              className={styles.trendSvg}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Claim outcome trend across ${model.bucketCount} ${bucket || "week"} buckets, peaking at ${model.maxCount} claims.`}
            >
              {/* Baseline only. A full gridline set would need its own scale
                  labels, and the legend already carries the totals. */}
              <line x1="0" y1="100" x2="100" y2="100" className={styles.trendAxis} />
              {model.series.map((series) => (
                <polyline
                  key={series.id}
                  points={series.points}
                  className={`${styles.trendLine} ${styles[series.tone]}`}
                  fill="none"
                  // Unscaled by the viewBox stretch, so a line is the same
                  // visual weight regardless of the box's aspect ratio.
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <span className={styles.trendPeak}>peak {model.maxCount}</span>
          </div>

          <div className={styles.trendAxisRow}>
            {model.ticks.map((tick) => (
              <span
                key={tick.id}
                className={styles.trendTick}
                style={{ left: `${tick.x}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </>
      )}
    </Zone>
  );
}
