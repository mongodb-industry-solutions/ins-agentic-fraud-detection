"use client";

import BackLink from "@/components/backLink/BackLink";
import Badge from "@/components/badge/Badge";
import ClaimsSummaryTable from "@/components/claimsSummaryTable/ClaimsSummaryTable";
import CoveragesTable from "@/components/coveragesTable/CoveragesTable";
import styles from "./PolicyDetail.module.css";
import usePolicyDetail from "./usePolicyDetail";

/**
 * Read-only policy record, reachable from the Policies list, from a customer's
 * "Policies held" table, or from a claim's policy reference.
 *
 * "View customer profile" is the deliberate reverse of that customer table:
 * together they make Customer ↔ Policy a bidirectional link rather than a
 * one-way drill.
 */
export default function PolicyDetail({ policyId, backLabel, onBack, onOpenCustomer, onOpenClaim }) {
  const { isLoading, error, detail } = usePolicyDetail(policyId);

  return (
    <main className={styles.content}>
      <BackLink label={backLabel} onClick={onBack} />

      {error && <div className={styles.note}>Couldn&apos;t load this policy: {error}</div>}

      {isLoading || !detail ? (
        <div className={styles.skeleton} />
      ) : (
        <>
          <div className={styles.headerZone}>
            <div className={styles.headerMain}>
              <div className={styles.titleRow}>
                {/* Mono at header scale, matching the claim view: a policy
                    number is an identifier, not a name. */}
                <span className={styles.policyId}>{detail.policyId}</span>
                <Badge label={detail.statusLabel} />
              </div>
              <span className={styles.subline}>Held by {detail.customerName}</span>

              <div className={styles.facts}>
                {detail.facts.map((fact) => (
                  <span key={fact.id} className={styles.fact}>
                    <span className={styles.factLabel}>{fact.label}</span>
                    <span className={fact.isMono ? styles.factMono : styles.factValue}>
                      {fact.value}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.outlineButton}
                onClick={() => onOpenCustomer(detail.customerId)}
              >
                View customer profile
              </button>
            </div>
          </div>

          {/* Both zones are the shared components the other screens use. */}
          <CoveragesTable coverages={detail.coverages} title="Coverages" />

          <ClaimsSummaryTable
            title="Claims filed under this policy"
            claims={detail.claimRows}
            emptyMessage="No claims have been filed on this policy."
            onOpenClaim={onOpenClaim}
          />
        </>
      )}
    </main>
  );
}
