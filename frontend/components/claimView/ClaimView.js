"use client";

import { useState } from "react";

import ClaimAudit from "@/components/claimAudit/ClaimAudit";
import ClaimCustomer from "@/components/claimCustomer/ClaimCustomer";
import ClaimLinked from "@/components/claimLinked/ClaimLinked";
import ClaimOverview from "@/components/claimOverview/ClaimOverview";
import ClaimPolicy from "@/components/claimPolicy/ClaimPolicy";
import Icon from "@/components/icons/Icons";
import ReportDrawer from "@/components/reportDrawer/ReportDrawer";
import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";
import styles from "./ClaimView.module.css";
import useClaimView from "./useClaimView";

export default function ClaimView({ claimId, backLabel, onBack, onOpenClaim, nudgeAnalyze }) {
  const claim = useClaimView(claimId);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const { header } = claim;

  // The nudge only makes sense while the claim has no score of its own.
  const showPulse = nudgeAnalyze && header && !header.isProcessed;

  return (
    <main className={styles.content}>
      <button type="button" className={styles.back} onClick={onBack}>
        <span className={styles.chevronLeft}>
          <Icon name="chevronDown" size={12} />
        </span>
        {backLabel}
      </button>

      {/* Persistent while the blocking condition holds — not a toast. */}
      {claim.closeConflict && (
        <div className={styles.conflictBanner}>
          <span className={styles.bannerIcon}>
            <Icon name="alert" size={14} />
          </span>
          Can&apos;t close this claim yet — it&apos;s been scored but is still awaiting your
          confirm/dismiss decision.
        </div>
      )}

      {claim.closeError && <div className={styles.errorNote}>Couldn&apos;t close this claim: {claim.closeError}</div>}

      {claim.isLoading || !header ? (
        <div className={styles.skeleton} />
      ) : (
        <>
          <div className={styles.headerZone}>
            <div className={styles.headerMain}>
              <div className={styles.titleRow}>
                <span className={styles.claimId}>{header.claimId}</span>
                <span className={styles.complexityBadge}>{header.complexityLabel}</span>
                <StatusPill statusKey={header.statusKey} label={header.statusLabel} />
                {/* Lifecycle flag, separate from the fraud status pill. */}
                <span className={header.isClosed ? styles.closedFlag : styles.lifecycleFlag}>
                  <Icon name="flag" size={11} />
                  {header.lifecycleLabel}
                </span>
              </div>
              <span className={styles.subline}>
                {header.subline}
                {header.closedAtLabel && (
                  <span className={styles.closedNote}> · closed {header.closedAtLabel}</span>
                )}
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
                {/* Omitted entirely, not dashed, before the claim is scored. */}
                {header.isProcessed && header.scoreLabel && (
                  <span className={styles.fact}>
                    <span className={styles.factLabel}>Score</span>
                    <span>
                      <ScoreChip value={header.scoreLabel} />
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className={styles.headerActions}>
              {/* Both actions are gated on the lifecycle flag: available while
                  OPEN, blocked once CLOSED. */}
              <button
                type="button"
                className={styles.outlineButton}
                onClick={claim.startEditing}
                disabled={claim.isEditing || header.isClosed}
                title={header.isClosed ? "This claim is closed and can't be edited" : undefined}
              >
                <Icon name={header.isClosed ? "lock" : "settings"} size={12} />
                {claim.isEditing ? "Editing…" : "Edit claim"}
              </button>
              <button
                type="button"
                className={styles.outlineButton}
                onClick={claim.requestClose}
                disabled={header.isClosed}
                title={header.isClosed ? "This claim is already closed" : undefined}
              >
                <Icon name={header.isClosed ? "lock" : "check"} size={12} />
                {header.isClosed ? "Closed" : "Close claim"}
              </button>
              <button
                type="button"
                className={`${styles.reportButton} ${showPulse ? styles.pulse : ""}`}
                onClick={() => setIsReportOpen(true)}
              >
                View fraud report
              </button>
            </div>
          </div>

          {/* Pure visibility toggle — all tab content came from one fetch. */}
          <div className={styles.tabs} role="tablist">
            {claim.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === claim.activeTab}
                className={`${styles.tab} ${tab.id === claim.activeTab ? styles.activeTab : ""}`}
                onClick={() => claim.setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {claim.activeTab === "overview" && (
            <ClaimOverview
              sections={claim.overviewSections}
              isEditing={claim.isEditing}
              drafts={claim.drafts}
              onDraftChange={claim.changeDraft}
              onSave={claim.save}
              onCancelEdit={claim.cancelEditing}
            />
          )}
          {claim.activeTab === "policy" && <ClaimPolicy policy={claim.policy} />}
          {claim.activeTab === "customer" && <ClaimCustomer customer={claim.customer} />}
          {claim.activeTab === "linked" && (
            <ClaimLinked linkedClaims={claim.linkedClaims} onOpenClaim={onOpenClaim} />
          )}
          {claim.activeTab === "audit" && (
            <ClaimAudit entries={claim.auditEntries} isProcessed={header.isProcessed} />
          )}
        </>
      )}

      {/* The same drawer component the dashboard opens, just a different id. */}
      {isReportOpen && (
        <ReportDrawer
          claimId={claimId}
          onClose={() => setIsReportOpen(false)}
          onViewClaim={onOpenClaim}
        />
      )}
    </main>
  );
}
