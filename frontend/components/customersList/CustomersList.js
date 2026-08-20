"use client";

import DataTable from "@/components/dataTable/DataTable";
import FilterMenu from "@/components/filterMenu/FilterMenu";
import PageHeader from "@/components/pageHeader/PageHeader";
import SearchInput from "@/components/searchInput/SearchInput";
import styles from "./CustomersList.module.css";
import useCustomersList from "./useCustomersList";

/**
 * The browsable customer directory. No segmented control, stat strip, pending
 * queue or donut here: all of that exists because claims carry fraud state, and
 * customers do not.
 */
export default function CustomersList({ onOpenCustomer }) {
  const list = useCustomersList();

  const columns = [
    { id: "name", label: "Customer", cellClass: "strong" },
    { id: "customerId", label: "Customer ID", cellClass: "mono" },
    { id: "sinceLabel", label: "Since", cellClass: "mono" },
    // Dropped rather than rendered as a column of em-dashes while the list
    // endpoint returns no address. See toCustomerRow.
    ...(list.hasLocation ? [{ id: "location", label: "Location" }] : []),
    { id: "policyCount", label: "Policies", cellClass: "mono", align: "right" },
    { id: "claimCount", label: "Claims", cellClass: "mono", align: "right" },
  ];

  return (
    <main className={styles.content}>
      <PageHeader title="Customers" subtitle={list.subtitle} />

      <div className={styles.filterRow}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search by name or customer ID…"
        />
        <span className={styles.spacer} />
        <FilterMenu
          control={list.sortControl}
          icon="sortDesc"
          align="right"
          onSelect={(_, optionId) => list.changeSort(optionId)}
        />
      </div>

      {list.error && <div className={styles.note}>Couldn&apos;t load customers: {list.error}</div>}

      <DataTable
        columns={columns}
        rows={list.rows}
        emptyMessage={
          list.isLoading
            ? "Loading customers…"
            : list.search
              ? `No customers match “${list.search}”.`
              : "No customers found."
        }
        actionLabel="View"
        onAction={onOpenCustomer}
      />
    </main>
  );
}
