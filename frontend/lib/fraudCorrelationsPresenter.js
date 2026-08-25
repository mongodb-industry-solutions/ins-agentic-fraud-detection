/**
 * Shapes `get_fraud_rate_breakdown` for the Correlations tab.
 *
 * Nothing here invents a bucket, a boundary or a label. Row labels come from
 * the response; only enum prettifying happens locally, using the same
 * `humanizeEnum` every other screen applies to these exact fields.
 */

import { humanizeEnum } from "./claimsPresenter";

/**
 * The five dimensions, keyed by the values the backend's enum accepts.
 *
 * The two bucketed ids end in `Bucket` because that is what the API validates
 * against — a shorter `claimAmount` is rejected with a 422 rather than
 * silently falling back to something.
 */
export const DIMENSIONS = [
  { id: "coverageType", label: "Coverage type" },
  { id: "claimType", label: "Claim type" },
  { id: "complexity", label: "Complexity" },
  { id: "claimAmountBucket", label: "Claim amount" },
  { id: "customerTenureBucket", label: "Customer tenure" },
];

export function dimensionLabel(dimension) {
  return DIMENSIONS.find((entry) => entry.id === dimension)?.label || dimension;
}

/**
 * The colour scale, as inclusive upper bounds on a 0..1 rate.
 *
 * Absolute, never rescaled to the current dataset's own maximum. Stretching the
 * ramp so that whatever happens to be worst reads as fully saturated would make
 * a portfolio whose worst segment sits at 15% look exactly as alarming as one
 * whose worst sits at 60%. Keeping it absolute means a dimension where every bar
 * is pale is telling the truth — nothing here is disproportionately risky —
 * rather than hiding variance behind a rendering choice.
 *
 * Two core tokens only: Mist at the bottom, Forest Green at the top, with four
 * interpolated steps between them. A sequential intensity ramp reads correctly
 * from two approved colours, so the reserved chart-only set is not needed here
 * and is therefore not allowed here.
 */
const RATE_STOPS = [
  { max: 0.1, tone: "rate0" },
  { max: 0.2, tone: "rate1" },
  { max: 0.3, tone: "rate2" },
  { max: 0.4, tone: "rate3" },
  { max: 0.6, tone: "rate4" },
  { max: Infinity, tone: "rate5" },
];

/** The CSS class carrying this rate's fill. */
export function toneForRate(rate) {
  const value = typeof rate === "number" && !Number.isNaN(rate) ? rate : 0;
  return RATE_STOPS.find((stop) => value <= stop.max).tone;
}

/** Legend entries describing what the ramp means, low to high. */
export const RATE_LEGEND = [
  { tone: "rate0", label: "0–10%" },
  { tone: "rate2", label: "20–30%" },
  { tone: "rate4", label: "40–60%" },
  { tone: "rate5", label: "60–100%" },
];

/** One decimal place, e.g. "66.7%". */
export function formatRate(rate) {
  if (typeof rate !== "number" || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Breakdown rows, sorted worst-first and ready to render.
 *
 * Sorted by confirmed rate descending regardless of the dimension's natural
 * order, because the point of a correlation view is surfacing what is
 * disproportionate — the outlier belongs at the top rather than wherever the
 * alphabet puts it. The chart and the table both read this one sorted array, so
 * a bar and its numbers are always on the same line as each other.
 *
 * Ties break on `total` then `label`, so the order is stable rather than
 * depending on however the aggregation happened to emit equal-rate groups —
 * this dataset has several exact ties (two dimensions where groups sit at a flat
 * 0.0 or 1.0), and without a tiebreak they could swap places between renders.
 *
 * Returns null when there is nothing to show, so the caller distinguishes empty
 * from loaded without counting array members itself.
 */
export function toBreakdownRows(data) {
  const rows = data?.breakdown || [];
  if (rows.length === 0) return null;

  const prepared = rows.map((row) => ({
    ...row,
    // `label` is authoritative; humanizeEnum prettifies a raw enum and is a
    // no-op on an already-formatted bucket label like "$2,500 – $5,000".
    displayLabel: humanizeEnum(row.label ?? row.value),
    rateLabel: formatRate(row.confirmedFraudRate),
    tone: toneForRate(row.confirmedFraudRate),
    // Bar length is the rate itself on a fixed 0–100% track, not a share of
    // the largest bar: the axis has an absolute meaning here and rescaling it
    // would misreport a 12% rate as a full-width bar.
    widthPct: Math.max(0, Math.min(100, (row.confirmedFraudRate ?? 0) * 100)),
  }));

  prepared.sort(
    (a, b) =>
      (b.confirmedFraudRate ?? 0) - (a.confirmedFraudRate ?? 0) ||
      (b.total ?? 0) - (a.total ?? 0) ||
      a.displayLabel.localeCompare(b.displayLabel)
  );

  return prepared;
}

/**
 * A one-line caveat when the rates rest on very few decided claims.
 *
 * Returned as data rather than rendered unconditionally because it is only worth
 * saying when it is true. A group of one flagged claim and no cleared ones is a
 * 100% confirmed rate, which is arithmetically correct and, read off a bar
 * chart, badly misleading — this dataset has exactly that shape, so the caveat
 * earns its place. Null when every group has a reasonable base.
 */
export function toConfidenceNote(rows) {
  if (!rows) return null;

  const decided = rows.reduce((sum, row) => sum + (row.decidedCount ?? 0), 0);
  const thin = rows.filter((row) => (row.decidedCount ?? 0) > 0 && row.decidedCount < 5);
  const undecided = rows.filter((row) => (row.decidedCount ?? 0) === 0);

  if (decided === 0) {
    return "No claims in this dimension have been confirmed or cleared yet, so every rate below is 0% for lack of decisions rather than lack of fraud.";
  }
  if (thin.length || undecided.length) {
    const parts = [];
    if (thin.length) {
      parts.push(
        `${thin.length} of ${rows.length} groups rest on fewer than 5 decided claims`
      );
    }
    if (undecided.length) {
      parts.push(`${undecided.length} have no decided claims at all`);
    }
    return `Rates are computed over decided claims only — ${parts.join(", and ")}. Read them as indicative, not settled.`;
  }
  return null;
}
