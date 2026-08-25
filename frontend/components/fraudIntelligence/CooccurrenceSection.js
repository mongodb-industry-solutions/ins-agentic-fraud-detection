import {
  toCooccurrenceNote,
  toHeatmap,
  toTopPairs,
} from "@/lib/patternInsightsPresenter";
import correlations from "./Correlations.module.css";
import patterns from "./Patterns.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * Which patterns fire together on the same claim.
 *
 * Surfaces two different findings: two rules that almost always co-occur may be
 * catching one signal twice, while two that occasionally co-occur and are each
 * independently meaningful are compounding risk.
 *
 * The colour ramp is the Correlations tab's — imported classes, one shared
 * `toneForRate`, no second gradient. The pairs list restates the notable cells
 * as precise text, because a heatmap is good for spotting a hot cell and bad for
 * reading its exact number across a busy grid.
 */
export default function CooccurrenceSection({ data, isLoading, error }) {
  const heatmap = toHeatmap(data);
  const pairs = toTopPairs(data);
  const note = toCooccurrenceNote(data);

  return (
    <Zone
      title="Pattern co-occurrence"
      subtitle="How often two patterns fire together on the same claim, relative to how often the rarer one fires at all."
    >
      {isLoading ? (
        <>
          <Skeleton height={196} />
          <Skeleton height={92} />
        </>
      ) : error ? (
        <ErrorState message={`Couldn't load pattern co-occurrence data: ${error}`} />
      ) : !heatmap ? (
        <EmptyState message="Not enough overlapping pattern activity yet to compute co-occurrence — at least two patterns need to have fired together on an analysed claim." />
      ) : (
        <>
          {note && <p className={correlations.note}>{note}</p>}

          <p className={patterns.axisNote}>
            {/* States the axis selection rather than leaving "top patterns"
                ambiguous — these are ordered by how often each fired in the
                analysed claims, which is the population the rates come from. */}
            Axis shows the {heatmap.axis.length} patterns that co-occur most within the
            analysed claims.
          </p>

          <div className={patterns.heatmapWrap}>
            <table className={patterns.heatmap}>
              <caption className={patterns.heatmapCaption}>
                Each cell is the share of the rarer pattern&apos;s matches on which the
                other also fired. Hover for the raw claim count.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={patterns.corner}>
                    <span className={patterns.srOnly}>Pattern</span>
                  </th>
                  {heatmap.axis.map((pattern) => (
                    <th
                      key={pattern.patternId}
                      scope="col"
                      className={patterns.colHead}
                      title={pattern.patternName || pattern.patternId}
                    >
                      {pattern.patternId}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.rows.map((row) => (
                  <tr key={row.patternId}>
                    <th
                      scope="row"
                      className={patterns.rowHead}
                      title={row.patternName || row.patternId}
                    >
                      {row.patternId}
                    </th>
                    {row.cells.map((cell) =>
                      cell.isDiagonal ? (
                        /* A pattern cannot co-occur with itself, so the
                           diagonal is a dead cell rather than a coloured one. */
                        <td key={cell.key} className={patterns.diagonal}>
                          —
                        </td>
                      ) : (
                        <td
                          key={cell.key}
                          className={`${patterns.cell} ${correlations[cell.tone]} ${
                            cell.light ? patterns.cellLight : patterns.cellDark
                          }`}
                          title={cell.title}
                        >
                          {cell.label}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pairs && (
            <div className={patterns.pairsBlock}>
              <span className={patterns.pairsTitle}>Most notable pairs</span>
              <ul className={patterns.pairsList}>
                {pairs.map((pair) => (
                  <li key={pair.id} className={patterns.pairRow}>
                    <span className={`${patterns.pairSwatch} ${correlations[pair.tone]}`} />
                    <span className={patterns.pairNames}>
                      <span className={patterns.pairId}>{pair.patternIdA}</span>
                      <span className={patterns.pairPlus}>+</span>
                      <span className={patterns.pairId}>{pair.patternIdB}</span>
                    </span>
                    <span className={patterns.pairMeta}>
                      {pair.patternNameA} · {pair.patternNameB}
                    </span>
                    <span className={patterns.pairCount}>
                      {pair.cooccurrenceCount} claims
                    </span>
                    <span className={patterns.pairRate}>{pair.rateLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Zone>
  );
}
