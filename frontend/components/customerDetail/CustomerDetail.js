"use client";

import Badge from "@/components/badge/Badge";
import BackLink from "@/components/backLink/BackLink";
import ClaimsSummaryTable from "@/components/claimsSummaryTable/ClaimsSummaryTable";
import DataTable from "@/components/dataTable/DataTable";
import styles from "./CustomerDetail.module.css";
import useCustomerDetail from "./useCustomerDetail";

/**
 * Read-only by design, not by omission: there is no update_customer tool in
 * the current backend scope, so this screen offers no edit affordance at all.
 */
export default function CustomerDetail({ customerId, backLabel, onBack, onOpenPolicy, onOpenClaim }) {
  const { isLoading, error, header, policyRows, claimRows } = useCustomerDetail(customerId);

  const policyColumns = [
    { id: "policyId", label: "Policy ID", cellClass: "mono" },
    { id: "typeLabel", label: "Type" },
    {
      id: "statusLabel",
      label: "Status",
      // Neutral Badge, never StatusPill: policy status and fraud status are
      // unrelated systems, and Light Green/Mist/Evergreen mean fraud state only.
      render: (row) => <Badge label={row.statusLabel} />,
    },
    { id: "periodLabel", label: "Effective period", cellClass: "mono" },
    { id: "premiumLabel", label: "Annual premium", cellClass: "mono", align: "right" },
  ];


  return (
    <main className={styles.content}>
      <BackLink label={backLabel} onClick={onBack} />

      {error && <div className={styles.note}>Couldn&apos;t load this customer: {error}</div>}

      {isLoading || !header ? (
        <div className={styles.skeleton} />
      ) : (
        <>
          <div className={styles.headerZone}>
            <h1 className={styles.name}>{header.name}</h1>
            <span className={styles.subline}>
              <span className={styles.mono}>{header.customerId}</span>
              {` · ${header.tenureLabel}`}
            </span>
            <div className={styles.facts}>
              {header.facts.map((fact) => (
                <span key={fact.id} className={styles.fact}>
                  <span className={styles.factLabel}>{fact.label}</span>
                  <span className={fact.isMono ? styles.factMono : styles.factValue}>
                    {fact.value}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <DataTable
            title="Policies held"
            columns={policyColumns}
            rows={policyRows}
            emptyMessage="This customer holds no policies."
            actionLabel="View"
            onAction={onOpenPolicy}
          />

          {/* Same component Policy Detail uses for its claims zone. */}
          <ClaimsSummaryTable
            title="Claims history"
            claims={claimRows}
            emptyMessage="This customer has filed no claims."
            onOpenClaim={onOpenClaim}
          />
        </>
      )}
    </main>
  );
}
