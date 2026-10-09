"use client";

import BulkActionBar from "@/components/bulkActionBar/BulkActionBar";
import ClaimsTable from "@/components/claimsTable/ClaimsTable";
import FilterRow from "@/components/filterRow/FilterRow";
import InsightsZone from "@/components/insightsZone/InsightsZone";
import PageHeader from "@/components/pageHeader/PageHeader";
import Pagination from "@/components/pagination/Pagination";
import ReportDrawer from "@/components/reportDrawer/ReportDrawer";
import SegmentedControl from "@/components/segmentedControl/SegmentedControl";
import StatStrip from "@/components/statStrip/StatStrip";
import styles from "./Dashboard.module.css";
import useDashboard from "./useDashboard";

export default function Dashboard({ queueJobs, onOpenClaim, onAnalyze }) {
  const dashboard = useDashboard(queueJobs);

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

          {/* Unanalysed claims live beside the donut; the table below lists
              only claims the agent has already assessed. */}
          <InsightsZone
            breakdown={dashboard.breakdown}
            pendingAssessment={dashboard.pendingAssessment}
            onAnalyze={onAnalyze}
            onViewDetails={onOpenClaim}
          />

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
          />

          <Pagination pagination={dashboard.pagination} onChange={dashboard.changePage} />
        </>
      )}

      {dashboard.reportClaimId && (
        <ReportDrawer
          claimId={dashboard.reportClaimId}
          statusKey={dashboard.rowById[dashboard.reportClaimId]?.statusKey}
          onClose={dashboard.closeReport}
          onViewClaim={onOpenClaim}
        />
      )}
    </main>
  );
}
