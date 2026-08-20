"use client";

import Badge from "@/components/badge/Badge";
import DataTable from "@/components/dataTable/DataTable";
import FilterMenu from "@/components/filterMenu/FilterMenu";
import PageHeader from "@/components/pageHeader/PageHeader";
import SearchInput from "@/components/searchInput/SearchInput";
import styles from "./PoliciesList.module.css";
import usePoliciesList from "./usePoliciesList";

/**
 * Policies are referenced by claims, not scored themselves — so no segmented
 * control, stat strip, pending queue or donut here either.
 */
const COLUMNS = [
  { id: "policyId", label: "Policy ID", cellClass: "mono" },
  // Deliberately not a link: one click target per row (the View button), so
  // there is no ambiguity about what clicking the name would do.
  { id: "customerName", label: "Customer", cellClass: "strong" },
  { id: "typeLabel", label: "Type" },
  {
    id: "statusLabel",
    label: "Status",
    // Neutral badge — policy status never borrows the fraud color grammar.
    render: (row) => <Badge label={row.statusLabel} />,
  },
  { id: "periodLabel", label: "Effective period", cellClass: "mono" },
  { id: "premiumLabel", label: "Annual premium", cellClass: "mono", align: "right" },
];

export default function PoliciesList({ onOpenPolicy }) {
  const list = usePoliciesList();

  return (
    <main className={styles.content}>
      <PageHeader title="Policies" subtitle={list.subtitle} />

      <div className={styles.filterRow}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search by policy or customer…"
        />
        {list.filterControls.map((control) => (
          <FilterMenu key={control.id} control={control} onSelect={list.changeFilter} />
        ))}
        <span className={styles.spacer} />
        <FilterMenu
          control={list.sortControl}
          icon="sortDesc"
          align="right"
          onSelect={(_, optionId) => list.changeSort(optionId)}
        />
      </div>

      {list.error && <div className={styles.note}>Couldn&apos;t load policies: {list.error}</div>}

      <DataTable
        columns={COLUMNS}
        rows={list.rows}
        emptyMessage={
          list.isLoading ? "Loading policies…" : "No policies match the current filters."
        }
        actionLabel="View"
        onAction={onOpenPolicy}
      />
    </main>
  );
}
