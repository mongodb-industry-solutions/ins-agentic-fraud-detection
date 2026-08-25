"use client";

import { useState } from "react";

import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import {
  DIMENSIONS,
  RATE_LEGEND,
  dimensionLabel,
  toBreakdownRows,
  toConfidenceNote,
} from "@/lib/fraudCorrelationsPresenter";
import correlations from "./Correlations.module.css";
import styles from "./FraudIntelligenceView.module.css";
import useFraudRateBreakdown from "./useFraudRateBreakdown";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * Confirmed-fraud rate against one claim dimension at a time.
 *
 * One fetch feeds both the chart and the table, so this tab has a single
 * loading/error state rather than the per-section states Overview and
 * Relationships need — there is only one thing that can fail.
 *
 * Chart and table read the same sorted array, worst-first, so a bar and its
 * exact numbers are always on the same row as each other.
 */
export default function CorrelationsTab() {
  const [dimension, setDimension] = useState("coverageType");
  const { data, isLoading, error } = useFraudRateBreakdown(dimension);

  const rows = toBreakdownRows(data);
  const note = toConfidenceNote(rows);
  const label = dimensionLabel(dimension);

  return (
    <div className={styles.tabBody}>
      <Zone
        title="Fraud rate by dimension"
        subtitle="Which segments of the portfolio carry a disproportionately high confirmed-fraud rate."
        action={
          <SegmentedControl
            segments={DIMENSIONS}
            activeId={dimension}
            onChange={setDimension}
            label="Correlation dimension"
          />
        }
      >
        {isLoading ? (
          <>
            <Skeleton height={132} />
            <Skeleton height={148} />
          </>
        ) : error ? (
          <ErrorState message={`Couldn't load the fraud rate breakdown: ${error}`} />
        ) : !rows ? (
          <EmptyState
            message={`No claims fall into any ${label.toLowerCase()} bucket yet.`}
          />
        ) : (
          <>
            {/* The rate's denominator is decided claims, so a group with one
                decision reads as 0% or 100%. Said out loud when it applies. */}
            {note && <p className={correlations.note}>{note}</p>}

            <div className={correlations.legendRow}>
              <span className={correlations.legendCaption}>Confirmed rate</span>
              {RATE_LEGEND.map((entry) => (
                <span key={entry.tone} className={styles.finLegendItem}>
                  <span
                    className={`${styles.finLegendDot} ${correlations[entry.tone]}`}
                  />
                  {entry.label}
                </span>
              ))}
            </div>

            <div className={correlations.barChart}>
              {rows.map((row) => (
                <div key={row.value} className={correlations.barRow}>
                  <span className={correlations.barLabel} title={row.displayLabel}>
                    {row.displayLabel}
                  </span>
                  {/* Fixed 0–100% track, so bar length is the rate itself
                      rather than a share of the longest bar. */}
                  <span className={correlations.barTrack}>
                    <span
                      className={`${correlations.barFill} ${correlations[row.tone]}`}
                      style={{ width: `${row.widthPct}%` }}
                    />
                  </span>
                  <span className={correlations.barValue}>{row.rateLabel}</span>
                </div>
              ))}
            </div>

            <div className={correlations.tableWrap}>
              <table className={correlations.table}>
                <caption className={correlations.tableCaption}>
                  Raw counts behind each rate. Confirmed rate is flagged ÷ (flagged +
                  cleared) — pending and unprocessed claims are excluded from the
                  denominator rather than counted as legitimate.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{label}</th>
                    <th scope="col" className={correlations.numHead}>Total</th>
                    <th scope="col" className={correlations.numHead}>Flagged</th>
                    <th scope="col" className={correlations.numHead}>Cleared</th>
                    <th scope="col" className={correlations.numHead}>Pending</th>
                    <th scope="col" className={correlations.numHead}>Unprocessed</th>
                    <th scope="col" className={correlations.numHead}>Decided</th>
                    <th scope="col" className={correlations.numHead}>Confirmed rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.value}>
                      <th scope="row" className={correlations.rowHead}>
                        {row.displayLabel}
                      </th>
                      <td className={correlations.num}>{row.total}</td>
                      <td className={correlations.num}>{row.flagged}</td>
                      <td className={correlations.num}>{row.cleared}</td>
                      <td className={correlations.num}>{row.pending}</td>
                      <td className={correlations.num}>{row.unprocessed}</td>
                      {/* The rate's denominator, shown so a 100% built on one
                          decision is visibly that. */}
                      <td className={correlations.num}>{row.decidedCount}</td>
                      <td className={`${correlations.num} ${correlations.rateCell}`}>
                        <span className={`${correlations.rateSwatch} ${correlations[row.tone]}`} />
                        {row.rateLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Zone>
    </div>
  );
}
