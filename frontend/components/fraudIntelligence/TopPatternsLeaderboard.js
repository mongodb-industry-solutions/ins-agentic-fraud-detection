import cardStyles from "@/components/fraudPatterns/PatternCard.module.css";
import { toLeaderboardRows, toShowingNote } from "@/lib/patternInsightsPresenter";
import patterns from "./Patterns.module.css";
import { EmptyState, ErrorState, Skeleton, Zone } from "./Zone";

/**
 * A curated top-5 snapshot, capped and not expandable.
 *
 * Deliberately not a second way to browse the catalogue — that is the Fraud
 * Patterns card-grid screen's job, and keeping the two visually and functionally
 * distinct is why this one is a fixed ranked list rather than a list with a
 * "show more".
 *
 * All five rows share one rank treatment. There is no rest-of-list on screen to
 * contrast a top-five badge against, so a second badge style would be marking a
 * distinction that is not visible.
 */
export default function TopPatternsLeaderboard({ data, isLoading, error }) {
  const rows = toLeaderboardRows(data);
  const note = toShowingNote(data, rows);

  return (
    <Zone
      title="Top patterns leaderboard"
      subtitle="Ranked by trigger volume. The 'why' line explains what makes each pattern actually reliable."
    >
      {isLoading ? (
        <div className={patterns.skeletonRows}>
          {/* Five, matching the real row count and height, so the layout does
              not jump when the data lands. */}
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} height={78} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={`Couldn't load the top patterns leaderboard: ${error}`} />
      ) : !rows ? (
        <EmptyState message="No patterns have been triggered yet." />
      ) : (
        <>
          <ol className={patterns.lbList}>
            {rows.map((pattern) => (
              <li key={pattern.patternId} className={patterns.lbRow}>
                <span className={patterns.lbRank}>{pattern.rank}</span>

                <div className={patterns.lbBody}>
                  <div className={patterns.lbTopRow}>
                    <span className={patterns.lbName}>
                      <span className={patterns.lbId}>{pattern.patternId}</span>
                      {pattern.patternName}
                    </span>
                    {/* The catalogue's own outline weight chip — never the solid
                        Lavender score chip, which means "the agent computed
                        this". A weight is static configuration. */}
                    <span className={cardStyles.weightChip}>{pattern.weightLabel}</span>
                  </div>

                  <div className={patterns.lbStats}>
                    <span className={patterns.lbStat}>
                      <span className={patterns.lbStatLabel}>Triggered</span>
                      <span className={patterns.lbStatValue}>{pattern.triggeredLabel}</span>
                    </span>
                    <span className={patterns.lbStat}>
                      <span className={patterns.lbStatLabel}>Confirmed</span>
                      <span className={patterns.lbStatValue}>{pattern.rateLabel}</span>
                    </span>
                    {/* The rate's numerator and denominator, so a percentage is
                        never the only thing on screen backing it. */}
                    <span className={patterns.lbStat}>
                      <span className={patterns.lbStatLabel}>Of matches</span>
                      <span className={patterns.lbStatValue}>{pattern.confirmedLabel}</span>
                    </span>
                  </div>

                  {/* Generated server-side from the pattern's own stats — not
                      assembled here. */}
                  <p className={patterns.lbWhy}>{pattern.whyEffective}</p>
                </div>
              </li>
            ))}
          </ol>

          {note && <p className={patterns.showingNote}>{note}</p>}
        </>
      )}
    </Zone>
  );
}
