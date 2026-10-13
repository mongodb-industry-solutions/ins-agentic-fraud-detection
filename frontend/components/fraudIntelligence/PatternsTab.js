"use client";

import CooccurrenceSection from "./CooccurrenceSection";
import styles from "./FraudIntelligenceView.module.css";
import TopPatternsLeaderboard from "./TopPatternsLeaderboard";
import usePatternsTab from "./usePatternsTab";

/**
 * Pattern reliability: what fires most, and what fires together.
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
    </div>
  );
}
