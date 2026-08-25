"use client";

import CooccurrenceSection from "./CooccurrenceSection";
import styles from "./FraudIntelligenceView.module.css";
import patterns from "./Patterns.module.css";
import TopPatternsLeaderboard from "./TopPatternsLeaderboard";
import { Zone } from "./Zone";
import usePatternsTab from "./usePatternsTab";

/**
 * Pattern reliability: what fires most, what fires together, and what cannot be
 * answered yet.
 */
export default function PatternsTab() {
  const { leaderboard, cooccurrence } = usePatternsTab();

  return (
    <div className={styles.tabBody}>
      <TopPatternsLeaderboard
        data={leaderboard.data}
        isLoading={leaderboard.isLoading}
        error={leaderboard.error}
      />

      <CooccurrenceSection
        data={cooccurrence.data}
        isLoading={cooccurrence.isLoading}
        error={cooccurrence.error}
      />

      <ReliabilityTrends />
    </div>
  );
}

/**
 * Static. No fetch, deliberately.
 *
 * There is no endpoint behind this yet, and calling one that cannot answer
 * would flash an error state before settling on this same message — worse than
 * simply not calling anything. When the timeseries collection and its tool
 * exist, this gets replaced outright by a real per-pattern trend chart rather
 * than extended: it holds no state worth carrying forward.
 *
 * The dashed, muted treatment is the app's existing "not available yet, and
 * here is why" convention, the same one pending-embedding patterns use.
 */
function ReliabilityTrends() {
  return (
    <Zone title="Reliability trends">
      <div className={patterns.pending}>
        <strong className={patterns.pendingHead}>
          Available once historical snapshots begin.
        </strong>
        <span>
          A pattern&apos;s <code className={patterns.code}>confirmedFraudRate</code> is stored as a
          single current value, so there is no history to plot a line from. This needs the{" "}
          <code className={patterns.code}>fraud_metrics_timeseries</code> collection to accumulate
          daily pattern-reliability snapshots first.
        </span>
      </div>
    </Zone>
  );
}
