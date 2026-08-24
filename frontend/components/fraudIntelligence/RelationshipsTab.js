"use client";

import styles from "./FraudIntelligenceView.module.css";
import RelationshipGraphSection from "./RelationshipGraphSection";
import RepeatEntitySection from "./RepeatEntitySection";
import SimilarityLeaderboardSection from "./SimilarityLeaderboardSection";
import useRelationshipsTab from "./useRelationshipsTab";

/**
 * Three readings of the same relationships: the network to explore, the
 * leaderboard to act on, and the repeat-entity lens that cuts across both.
 *
 * The graph and the leaderboard share one scope, owned by the hook — they
 * describe the same connections, so letting each filter itself would let the
 * screen contradict itself.
 */
export default function RelationshipsTab({ onOpenClaim }) {
  const tab = useRelationshipsTab();

  return (
    <div className={styles.tabBody}>
      <RelationshipGraphSection
        data={tab.graph.data}
        isLoading={tab.graph.isLoading}
        error={tab.graph.error}
        scope={tab.scope}
        onScopeChange={tab.changeScope}
        onOpenClaim={onOpenClaim}
      />

      <SimilarityLeaderboardSection
        data={tab.leaderboard.data}
        isLoading={tab.leaderboard.isLoading}
        error={tab.leaderboard.error}
        onOpenClaim={onOpenClaim}
      />

      <RepeatEntitySection
        data={tab.entities.data}
        isLoading={tab.entities.isLoading}
        error={tab.entities.error}
        entityType={tab.entityType}
        onEntityTypeChange={tab.changeEntityType}
        onOpenClaim={onOpenClaim}
      />
    </div>
  );
}
