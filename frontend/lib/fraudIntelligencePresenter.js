/**
 * Shapes the Fraud Intelligence overview's API responses into what its
 * components render. Every value here traces back to a field on a real
 * response — there is no fallback data in this file, and a missing field
 * becomes `null` so the component can show its empty state rather than a
 * plausible-looking number.
 */

import { STATUS } from "./claimsPresenter";

/**
 * The sub-tabs. Overview, Relationships and Correlations are built; Patterns is
 * a separate pass.
 *
 * Operations and Activity were dropped rather than left as permanent
 * placeholders — a tab that will never be built is worse than no tab, because it
 * reads as unfinished work rather than as a decision. The backing tools
 * (`get_review_queue_metrics`, `get_reviewer_activity_stats`,
 * `get_recent_agent_activity`) are still live and tested; nothing in this
 * section surfaces them now.
 */
export const FI_TABS = [
  { id: "overview", label: "Overview" },
  { id: "relationships", label: "Relationships" },
  { id: "patterns", label: "Patterns" },
  { id: "correlations", label: "Correlations" },
];

/**
 * Whole dollars, no cents. These are portfolio aggregates read at a glance, and
 * two decimal places on a six-figure total is noise that makes the number
 * harder to compare against the one beside it.
 */
export function formatCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** A 0..1 rate as a percentage. `null` in, `null` out — never "0%". */
export function formatRate(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${(value * 100).toFixed(1)}%`;
}

/** One decimal place, matching how a score band boundary is discussed. */
export function formatScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value.toFixed(1);
}

export function formatCount(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return String(value);
}

/** Placeholder shown in a KPI cell whose figure has not arrived or does not exist. */
const NO_VALUE = "—";

/**
 * The two financial bars.
 *
 * Bar A and the base segment of Bar B are both `currentFinancialImpact` and are
 * therefore given the identical width, so the only difference between the two
 * bars is the avoided-cost segment sitting on the end of the second one. The
 * reader subtracts by looking, which is the entire point of the component.
 *
 * Returns null when there is nothing decided to measure — the caller renders an
 * empty state rather than two zero-width bars.
 */
export function toFinancialBars(data) {
  if (!data) return null;

  const current = data.currentFinancialImpact;
  const avoided = data.fraudCostAvoided;
  const total = data.potentialImpactWithoutTool;

  if (typeof total !== "number" || total <= 0) return null;

  const currentPct = (current / total) * 100;
  const avoidedPct = (avoided / total) * 100;

  return {
    rows: [
      {
        id: "current",
        label: "What you pay today",
        total: formatCurrency(current),
        segments: [{ id: "current", pct: currentPct, tone: "current" }],
      },
      {
        id: "without",
        label: "Without this tool",
        total: formatCurrency(total),
        segments: [
          { id: "current", pct: currentPct, tone: "current" },
          { id: "avoided", pct: avoidedPct, tone: "avoided" },
        ],
      },
    ],
    secondary: [
      {
        id: "avgFraud",
        label: "Avg. claim amount — confirmed fraud",
        value: formatCurrency(data.avgClaimAmountFraud) || NO_VALUE,
      },
      {
        id: "avgLegit",
        label: "Avg. claim amount — legitimate",
        value: formatCurrency(data.avgClaimAmountLegitimate) || NO_VALUE,
      },
    ],
  };
}

/**
 * The four KPI cells, in the shape StatStrip already consumes.
 *
 * `statusKey` picks the icon chip's colour from the status system rather than
 * introducing a second icon language for metrics that already appear on the
 * Dashboard. "Flagged this period" keeps the Dashboard's own chip and `alert`
 * icon for exactly that reason — it is the same number in a second place, so it
 * should not look like a different metric.
 */
export function toKpiStats({ confirmedRate, activePatternCount, avgScore, flaggedCount }) {
  return [
    {
      id: "confirmedRate",
      label: "Confirmed fraud rate",
      value: formatRate(confirmedRate) || NO_VALUE,
      statusKey: STATUS.FLAGGED,
      icon: "alert",
    },
    {
      id: "activePatterns",
      label: "Active patterns",
      value: formatCount(activePatternCount) || NO_VALUE,
      statusKey: STATUS.UNPROCESSED,
      icon: "activity",
    },
    {
      id: "avgScore",
      label: "Avg. computed score",
      value: formatScore(avgScore) || NO_VALUE,
      statusKey: STATUS.UNPROCESSED,
      icon: "bolt",
    },
    {
      id: "flagged",
      // Same wording as the Dashboard's stat card, because it is the same
      // figure read from the same aggregation.
      label: "Flagged as fraud",
      value: formatCount(flaggedCount) || NO_VALUE,
      statusKey: STATUS.CLEARED,
      icon: "check",
    },
  ];
}

/** The four trend series, and which reserved chart colour each one draws in. */
export const TREND_SERIES = [
  { id: "flagged", label: "Flagged", tone: "flagged" },
  { id: "cleared", label: "Cleared", tone: "cleared" },
  { id: "pending", label: "Pending review", tone: "pending" },
  { id: "unprocessed", label: "Not yet analyzed", tone: "unprocessed" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns the trend array into one polyline per series, in a 0..100 x 0..100
 * viewBox that the SVG scales to whatever box it is given.
 *
 * Two things are computed from the data rather than fixed:
 *
 * * The Y scale is 0..max-across-all-series, so the tallest point touches the
 *   top of the plot whatever the portfolio's size. It is NOT min..max — a count
 *   series has a meaningful zero, and starting the axis at the smallest observed
 *   count would exaggerate a difference of one claim into a full-height climb.
 * * X positions come from each bucket's own timestamp, not from its index. The
 *   buckets are sparse — a week with no claims is absent from the response
 *   entirely — so spacing them evenly would silently close the gaps and draw a
 *   quiet month as though it were continuous activity.
 *
 * Returns null when there is nothing to draw, including the single-bucket case:
 * one point is not a trend, and a polyline of one point renders as nothing at
 * all, so the caller shows its empty state instead.
 */
export function toTrendChart(trend) {
  const buckets = (trend || [])
    .map((bucket) => ({ ...bucket, time: Date.parse(bucket.bucket) }))
    .filter((bucket) => !Number.isNaN(bucket.time))
    .sort((a, b) => a.time - b.time);

  if (buckets.length < 2) return null;

  const firstTime = buckets[0].time;
  const lastTime = buckets[buckets.length - 1].time;
  const timeSpan = lastTime - firstTime || 1;

  const maxCount = Math.max(
    1,
    ...buckets.flatMap((bucket) => TREND_SERIES.map((series) => bucket[series.id] ?? 0))
  );

  const xFor = (time) => ((time - firstTime) / timeSpan) * 100;
  const yFor = (count) => 100 - (count / maxCount) * 100;

  const series = TREND_SERIES.map((definition) => ({
    ...definition,
    points: buckets
      .map((bucket) => `${xFor(bucket.time).toFixed(2)},${yFor(bucket[definition.id] ?? 0).toFixed(2)}`)
      .join(" "),
    // The series total over the window, so the legend says how much of each
    // outcome the line actually represents instead of only naming a colour.
    total: buckets.reduce((sum, bucket) => sum + (bucket[definition.id] ?? 0), 0),
  }));

  return {
    series,
    maxCount,
    bucketCount: buckets.length,
    ticks: buckets.map((bucket) => ({
      id: bucket.bucket,
      x: xFor(bucket.time),
      label: formatBucketTick(bucket.time),
    })),
    spanDays: Math.round(timeSpan / DAY_MS),
  };
}

/** "12 Jan" — short enough to sit under a bar without rotating. */
function formatBucketTick(time) {
  return new Date(time).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** "12 Jan 2025 — 12 Mar 2025", for stating the window a chart actually covers. */
export function formatWindow(dateFrom, dateTo) {
  const from = Date.parse(dateFrom);
  const to = Date.parse(dateTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;

  const format = (time) =>
    new Date(time).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  return `${format(from)} — ${format(to)}`;
}

/**
 * The histogram's bars, straight from the response.
 *
 * Bar heights are relative to the tallest bucket so the chart stays readable at
 * any portfolio size, and `band` is passed through untouched: the colour of a
 * bar is whatever band the backend assigned to that score, never a threshold
 * re-derived here. That is what keeps a score of 8 the same colour in this
 * histogram as in a fraud report.
 */
export function toHistogramBars(distribution) {
  const buckets = distribution || [];
  if (buckets.length === 0) return null;

  const maxCount = Math.max(...buckets.map((bucket) => bucket.count ?? 0));
  // Every bucket at zero is a real state — claims scored, none at any score we
  // can chart — but it has no bars to draw, so it reads as empty.
  if (maxCount <= 0) return null;

  return {
    maxCount,
    total: buckets.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0),
    bars: buckets.map((bucket) => ({
      score: bucket.score,
      count: bucket.count ?? 0,
      band: bucket.band,
      heightPct: ((bucket.count ?? 0) / maxCount) * 100,
    })),
  };
}

/** Legend rows for the histogram, labelled by the bands the backend sends. */
export function toHistogramLegend(distribution) {
  const seen = [];
  (distribution || []).forEach((bucket) => {
    if (bucket.band && !seen.includes(bucket.band)) seen.push(bucket.band);
  });
  return seen.map((band) => ({ band, label: BAND_LABEL[band] || band }));
}

/** Prose for each band the backend can send. */
const BAND_LABEL = {
  LOW: "Low",
  REVIEW: "Review",
  HIGH: "High",
};
