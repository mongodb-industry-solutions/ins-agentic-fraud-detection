/**
 * Shapes the Fraud Intelligence overview's API responses into what its
 * components render. Every value here traces back to a field on a real
 * response — there is no fallback data in this file, and a missing field
 * becomes `null` so the component can show its empty state rather than a
 * plausible-looking number.
 */

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
 * The four KPI cells, in the shape StatStrip consumes.
 *
 * `tone` walks the brand green ramp (see StatStrip.module.css), the same as the
 * dashboard's strip. "Flagged as fraud" keeps the dashboard's wording because it
 * is the same figure read from the same aggregation.
 */
export function toKpiStats({ confirmedRate, activePatternCount, avgScore, flaggedCount }) {
  return [
    {
      id: "confirmedRate",
      label: "Confirmed fraud rate",
      hint: "Of claims with a decision",
      value: formatRate(confirmedRate) || NO_VALUE,
      tone: "forest",
      icon: "alert",
    },
    {
      id: "activePatterns",
      label: "Active patterns",
      hint: "Checked against every claim",
      value: formatCount(activePatternCount) || NO_VALUE,
      tone: "leaf",
      icon: "activity",
    },
    {
      id: "avgScore",
      label: "Avg. computed score",
      hint: "Out of 12 across scored claims",
      value: formatScore(avgScore) || NO_VALUE,
      tone: "spring",
      icon: "bolt",
    },
    {
      id: "flagged",
      label: "Flagged as fraud",
      hint: "Confirmed by a reviewer",
      value: formatCount(flaggedCount) || NO_VALUE,
      tone: "chartreuse",
      icon: "shield",
    },
  ];
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
  FAST_TRACK: "Fast-track (0–3)",
  REVIEW: "Review (4–8)",
  PRIORITY: "Priority (9–12)",
};
