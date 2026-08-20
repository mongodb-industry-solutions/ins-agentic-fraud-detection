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

export default function Dashboard({ onOpenClaim }) {
  const dashboard = useDashboard();

  return (
    <main className={styles.content}>
      <PageHeader title="Claims portfolio" subtitle={dashboard.summary} />

      <StatStrip stats={dashboard.stats} />

      <PendingQueue queue={dashboard.pendingQueue} onReview={onOpenClaim} />

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
        // Sends the person to the claim with its fraud action emphasized,
        // since triggering analysis is why they were sent there.
        onAnalyze={(claimId) => onOpenClaim(claimId, { analyze: true })}
      />

      {dashboard.reportClaimId && (
        <ReportDrawer
          claimId={dashboard.reportClaimId}
          row={dashboard.reportRow}
          onClose={dashboard.closeReport}
          onViewClaim={onOpenClaim}
        />
      )}
    </main>
  );
}
