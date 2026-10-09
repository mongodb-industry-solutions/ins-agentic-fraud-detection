"use client";

import BulkActionBar from "@/components/bulkActionBar/BulkActionBar";
import ClaimsTable from "@/components/claimsTable/ClaimsTable";
import FilterRow from "@/components/filterRow/FilterRow";
import InsightsZone from "@/components/insightsZone/InsightsZone";
import PageHeader from "@/components/pageHeader/PageHeader";
import PendingQueue from "@/components/pendingQueue/PendingQueue";
import ReportDrawer from "@/components/reportDrawer/ReportDrawer";
import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import StatStrip from "@/components/statStrip/StatStrip";
import styles from "./Dashboard.module.css";
import useDashboard from "./useDashboard";

export default function Dashboard({ onOpenClaim, onAnalyze }) {
  const dashboard = useDashboard();

  return (
    <main className={styles.content}>
      <PageHeader title="Claims portfolio" subtitle={dashboard.summary} />

      {/* Stated, never quietly substituted with fixture data: an empty
          dashboard is honest, a plausible-looking fake one is not. */}
      {dashboard.error && (
        <div className={styles.errorNote}>Couldn&apos;t load the portfolio: {dashboard.error}</div>
      )}

      {dashboard.isLoading ? (
        <>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </>
      ) : (
        <>
          <StatStrip stats={dashboard.stats} />

          {/* Two actions, because the queue holds two kinds of work: a scored
              claim opens for a decision, an unanalysed one runs the agent. */}
          <PendingQueue
            queue={dashboard.pendingQueue}
            onReview={onOpenClaim}
            onAnalyze={onAnalyze}
          />

          <InsightsZone breakdown={dashboard.breakdown} events={dashboard.activityFeed} />

          <FilterRow
            controls={dashboard.filterControls}
            sortControl={dashboard.sortControl}
            showClear={dashboard.hasFilters}
            onFilterChange={dashboard.changeFilter}
            onSortChange={dashboard.changeSort}
            onClear={dashboard.clearFilters}
          />

          {/* Sits directly above the table it filters. */}
          <SegmentedControl
            segments={dashboard.segments}
            activeId={dashboard.activeSegment}
            onChange={dashboard.changeSegment}
          />

          <BulkActionBar selectedCount={dashboard.selectedIds.length} />

          <ClaimsTable
            rows={dashboard.rows}
            showCheckboxes={dashboard.showCheckboxes}
            selectedIds={dashboard.selectedIds}
            onToggleRow={dashboard.toggleRow}
            onViewReport={dashboard.openReport}
            onViewDetails={onOpenClaim}
            // Runs the assessment right here. Navigating to the claim first
            // made the person hunt for a second button to do what they had
            // already asked for.
            onAnalyze={onAnalyze}
          />
        </>
      )}

      {dashboard.reportClaimId && (
        <ReportDrawer
          claimId={dashboard.reportClaimId}
          onClose={dashboard.closeReport}
          onViewClaim={onOpenClaim}
        />
      )}
    </main>
  );
}
