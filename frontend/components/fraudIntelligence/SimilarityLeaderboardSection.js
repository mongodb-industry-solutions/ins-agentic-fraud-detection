import { toClusterRows } from "@/lib/fraudRelationshipsPresenter";
import graph from "./Relationships.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * The same relationships as the graph above, ranked for action.
 *
 * Read top-down as a work queue: the ordering does the prioritising that a node
 * layout cannot. Every claim chip is independently clickable, so no member of a
 * cluster is reachable only by opening another claim first and finding it under
 * that claim's Linked tab.
 *
 * `sharedReason` is rendered as sent. It is composed server-side, in plain
 * language and naming the pattern rather than citing its id, so this component
 * does not assemble prose out of edge-type enums.
 */
export default function SimilarityLeaderboardSection({ data, isLoading, error, onOpenClaim }) {
  const rows = toClusterRows(data);

  return (
    <Zone
      title="Claim similarity leaderboard"
      subtitle="Clusters worth investigating as a group, ranked by average score with a point for each claim beyond the first pair."
    >
      {isLoading ? (
        <Skeleton height={150} />
      ) : error ? (
        <ErrorState message={`Couldn't load the similarity leaderboard: ${error}`} />
      ) : !rows ? (
        <EmptyState message="No claim clusters meet the similarity threshold for this scope yet." />
      ) : (
        <>
          <ul className={graph.clusterList}>
            {rows.map((cluster) => (
              <li key={cluster.clusterId} className={graph.clusterRow}>
                <span className={graph.rankBadge}>{cluster.rank}</span>

                <div className={graph.clusterMain}>
                  <div className={graph.chipRow}>
                    {cluster.claimIds.map((claimId) => (
                      <button
                        key={claimId}
                        type="button"
                        className={graph.claimChip}
                        onClick={() => onOpenClaim?.(claimId)}
                      >
                        {claimId}
                      </button>
                    ))}
                  </div>
                  <span className={graph.clusterReason}>{cluster.sharedReason}</span>
                </div>

                <div className={graph.clusterScores}>
                  <span className={graph.scoreStat}>
                    <span className={graph.scoreStatLabel}>Avg</span>
                    <span className={graph.scoreStatValue}>{cluster.avgScoreLabel}</span>
                  </span>
                  <span className={graph.scoreStat}>
                    <span className={graph.scoreStatLabel}>Max</span>
                    <span className={graph.scoreStatValue}>{cluster.maxScoreLabel}</span>
                  </span>
                  <span className={graph.scoreStat}>
                    <span className={graph.scoreStatLabel}>Confirmed</span>
                    <span className={graph.scoreStatValue}>
                      {cluster.confirmedCount}/{cluster.claimCount}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/* States what the list left out, since `limit` caps the rows. */}
          {data.total > rows.length && (
            <p className={graph.graphFoot}>
              Showing the top {rows.length} of {data.total} clusters.
            </p>
          )}
        </>
      )}
    </Zone>
  );
}
