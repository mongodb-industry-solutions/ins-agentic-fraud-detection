import DataTable from "@/components/dataTable/DataTable";

/**
 * The one coverage-lines table, used by the claim view's Policy tab and by
 * Policy Detail. Monetary values are mono and uppercase-forced per the type
 * rule; column set and formatting live here so the two screens cannot drift.
 */
const COLUMNS = [
  { id: "name", label: "Coverage" },
  { id: "limitLabel", label: "Limit", cellClass: "mono", align: "right" },
  { id: "deductibleLabel", label: "Deductible", cellClass: "mono", align: "right" },
  { id: "premiumLabel", label: "Annual premium", cellClass: "mono", align: "right" },
];

export default function CoveragesTable({ coverages, title = "Coverage lines" }) {
  return (
    <DataTable
      title={title}
      columns={COLUMNS}
      rows={coverages}
      emptyMessage="This policy carries no coverage lines."
    />
  );
}
