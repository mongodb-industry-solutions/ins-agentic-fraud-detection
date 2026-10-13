"use client";

import DataTable from "@/components/dataTable/DataTable";
import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";

/**
 * The one claims-summary table, used by Customer Detail and Policy Detail.
 *
 * These rows genuinely are fraud-scored, so unlike the policies table they use
 * the real StatusPill and score chip.
 */
const COLUMNS = [
  { id: "claimId", label: "Claim ID", cellClass: "mono" },
  { id: "typeLabel", label: "Type" },
  { id: "openedLabel", label: "Opened", cellClass: "mono" },
  {
    id: "statusKey",
    label: "Status",
    render: (row) => <StatusPill statusKey={row.statusKey} label={row.statusLabel} />,
  },
  { id: "scoreLabel", label: "Score", render: (row) => <ScoreChip value={row.scoreLabel} /> },
];

export default function ClaimsSummaryTable({ title, claims, emptyMessage, onOpenClaim }) {
  return (
    <DataTable
      title={title}
      columns={COLUMNS}
      rows={claims}
      emptyMessage={emptyMessage}
      actionLabel="View details"
      onAction={onOpenClaim}
    />
  );
}
