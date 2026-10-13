import StatStrip from "@/components/statStrip/StatStrip";
import { toKpiStats } from "@/lib/fraudIntelligencePresenter";
import FinancialImpactSection from "./FinancialImpactSection";
import styles from "./FraudIntelligenceView.module.css";
import ScoreDistributionHistogram from "./ScoreDistributionHistogram";
import { ErrorState, Skeleton } from "./Zone";
import useOverviewTab from "./useOverviewTab";

/**
 * Three blocks, three independent states.
 *
 * `portfolio-stats` is fetched once by the hook and shared by the KPI strip and
 * the histogram. Each block still owns its own loading and error rendering, so a
 * failure in one endpoint leaves the others fully usable.
 */
export default function OverviewTab() {
  const { financial, portfolio, reference, isKpiLoading, kpiError } = useOverviewTab();
  const stats = portfolio.data;

  return (
    <div className={styles.tabBody}>
      <FinancialImpactSection
        data={financial.data}
        isLoading={financial.isLoading}
        error={financial.error}
      />

      {/* The same StatStrip the Dashboard uses — one bordered zone divided by
          hairlines, not four floating cards. */}
      {isKpiLoading ? (
        <Skeleton height={96} />
      ) : kpiError ? (
        <ErrorState message={`Couldn't load portfolio metrics: ${kpiError}`} />
      ) : (
        <StatStrip
          stats={toKpiStats({
            confirmedRate: stats?.overallConfirmedFraudRate,
            activePatternCount: reference.data?.activePatternCount,
            avgScore: stats?.avgComputedScore,
            flaggedCount: reference.data?.flaggedCount,
          })}
        />
      )}

      <ScoreDistributionHistogram
        distribution={stats?.scoreDistribution}
        isLoading={portfolio.isLoading}
        error={portfolio.error}
      />
    </div>
  );
}
