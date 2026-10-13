/**
 * Shapes the Patterns sub-tab's two responses.
 *
 * The colour ramp is imported from the Correlations presenter rather than
 * redefined: both this heatmap and that tab's bars mean "a rate from 0 to 100%,
 * coloured by intensity", and one shared function is what stops the two from
 * drifting into two independently-tuned gradients.
 */

import { toneForRate } from "./fraudCorrelationsPresenter";
import { toRateLabel, toWeightLabel } from "./fraudPatternsPresenter";

export { toneForRate };

/**
 * Above this rate a cell's background is dark enough that dark text stops being
 * legible on it.
 *
 * Checked against the ramp rather than assumed: `rate5` — solid Forest Green —
 * is the only step that begins above 0.6, so this threshold and the top step
 * cover exactly the same range. If a step is ever added between 0.4 and 1.0,
 * this needs revisiting alongside it.
 */
const LIGHT_TEXT_ABOVE = 0.6;

export function needsLightText(rate) {
  return typeof rate === "number" && rate > LIGHT_TEXT_ABOVE;
}

/**
 * Leaderboard rows.
 *
 * The rank is the response's own order — the server ranked these, and
 * re-sorting here would risk numbering rows in a different order than the
 * server's own `rankedBy` claims.
 *
 * Returns null when there is nothing to rank.
 */
export function toLeaderboardRows(data) {
  const patterns = data?.patterns || [];
  if (patterns.length === 0) return null;

  return patterns.map((pattern, index) => ({
    ...pattern,
    rank: index + 1,
    weightLabel: toWeightLabel(pattern.weight),
    rateLabel: toRateLabel(pattern.confirmedFraudRate),
    triggeredLabel: String(pattern.timesTriggered ?? 0),
    confirmedLabel: `${pattern.confirmedCount ?? 0} of ${pattern.timesTriggered ?? 0}`,
  }));
}

/** "Showing top 5 of 19 active patterns", or null if the count is unknown. */
export function toShowingNote(data, rows) {
  const total = data?.totalActivePatternCount;
  if (!rows || typeof total !== "number") return null;
  if (total <= rows.length) {
    return `Showing all ${total} active patterns.`;
  }
  return `Showing top ${rows.length} of ${total} active patterns, ranked by trigger volume.`;
}

/**
 * The heatmap grid.
 *
 * Cells are read out of the response's symmetric `matrix`; the diagonal is
 * rendered dead because a pattern cannot co-occur with itself, and colouring it
 * by any rate would be meaningless.
 *
 * Returns null below two axis patterns — a one-by-one grid has no cell in it.
 */
export function toHeatmap(data) {
  const axis = data?.topPatterns || [];
  if (axis.length < 2) return null;

  const matrix = data?.matrix || {};

  return {
    axis,
    rows: axis.map((rowPattern) => ({
      ...rowPattern,
      cells: axis.map((colPattern) => {
        if (colPattern.patternId === rowPattern.patternId) {
          return { key: colPattern.patternId, isDiagonal: true };
        }
        const cell = matrix[rowPattern.patternId]?.[colPattern.patternId];
        return {
          key: colPattern.patternId,
          isDiagonal: false,
          // No cell means the pair never co-occurred above the threshold. That
          // is a real zero, not missing data, so it is rendered as 0% rather
          // than blanked.
          hasValue: Boolean(cell),
          count: cell?.count ?? 0,
          rate: cell?.rate ?? 0,
          catalogueRate: cell?.catalogueRate ?? null,
          label: cell ? formatPct(cell.rate) : "0%",
          tone: toneForRate(cell?.rate ?? 0),
          light: needsLightText(cell?.rate ?? 0),
          title: cell
            ? `${rowPattern.patternId} + ${colPattern.patternId}\n` +
              `${cell.count} claim(s) in common\n` +
              `${formatPct(cell.rate)} of the rarer pattern's matches in the analysed claims` +
              (cell.catalogueRate !== null && cell.catalogueRate !== undefined
                ? `\n${formatPct(cell.catalogueRate)} against catalogue-wide trigger counts`
                : "")
            : `${rowPattern.patternId} + ${colPattern.patternId}\nNever fired together in the analysed claims`,
        };
      }),
    })),
  };
}

/** Notable pairs, exactly as ranked by the server. */
export function toTopPairs(data) {
  const pairs = data?.topPairs || [];
  if (pairs.length === 0) return null;

  return pairs.map((pair) => ({
    ...pair,
    id: `${pair.patternIdA}-${pair.patternIdB}`,
    rateLabel: formatPct(pair.observedCooccurrenceRate),
    catalogueRateLabel:
      pair.cooccurrenceRate === null || pair.cooccurrenceRate === undefined
        ? null
        : formatPct(pair.cooccurrenceRate),
    tone: toneForRate(pair.observedCooccurrenceRate ?? 0),
  }));
}

/**
 * The caveat that makes the heatmap's numbers readable honestly.
 *
 * Every rate on this grid is computed over the claims that have actually been
 * analysed, which on a young portfolio is a handful — and a pair seen twice out
 * of two possible times is a 100% co-occurrence rate that means far less than it
 * looks like. Returned as data so it can be omitted once the sample is large
 * enough to speak for itself.
 */
export function toCooccurrenceNote(data) {
  const analysed = data?.claimsAnalyzed ?? 0;
  if (analysed === 0) return null;
  if (analysed >= 30) return null;

  return (
    `Computed over the ${analysed} analysed claim${analysed === 1 ? "" : "s"} that matched at least ` +
    `one pattern. Rates are relative to that sample, not to each pattern's full recorded history — ` +
    `a pair seen twice out of two opportunities reads as 100%. Hover a cell for both figures.`
  );
}

function formatPct(rate) {
  if (typeof rate !== "number" || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}
