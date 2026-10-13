"use client";

import { useState } from "react";

import AnalyzeButton from "@/components/assessmentQueue/AnalyzeButton";
import BackLink from "@/components/backLink/BackLink";
import Badge from "@/components/badge/Badge";
import ClaimAudit from "@/components/claimAudit/ClaimAudit";
import ClaimCustomer from "@/components/claimCustomer/ClaimCustomer";
import ClaimLinked from "@/components/claimLinked/ClaimLinked";
import ClaimOverview from "@/components/claimOverview/ClaimOverview";
import ClaimPolicy from "@/components/claimPolicy/ClaimPolicy";
import Icon from "@/components/icons/Icons";
import ReportDrawer from "@/components/reportDrawer/ReportDrawer";
import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";
import TabBar from "@/components/tabBar/TabBar";
import styles from "./ClaimView.module.css";
import useClaimView from "./useClaimView";

export default function ClaimView({ claimId, backLabel, onBack, onOpenClaim, onAnalyze, nudgeAnalyze }) {
  const claim = useClaimView(claimId);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const { header } = claim;

  // The nudge only makes sense while the claim has no score of its own.
  const showPulse = nudgeAnalyze && header && !header.isProcessed;

  return (
    <main className={styles.content}>
      <BackLink label={backLabel} onClick={onBack} />

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

      {!claim.isLoading && claim.loadError ? (
        <div className={styles.errorNote} role="alert">
          Couldn&apos;t load claim {claimId}: {claim.loadError}{" "}
          <button type="button" className={styles.retryButton} onClick={claim.retry}>
            Try again
          </button>
        </div>
      ) : claim.isLoading || !header ? (
        <div className={styles.skeleton} />
      ) : (
        <>
          <div className={styles.headerZone}>
            <div className={styles.headerMain}>
              <div className={styles.titleRow}>
                <span className={styles.claimId}>{header.claimId}</span>
                <Badge label={header.complexityLabel} />
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
              {/* Two distinct actions, not one button with two meanings: an
                  unscored claim has no report to view, and a scored one should
                  not silently re-run a 90-second assessment. */}
              {header.isProcessed && (
                <button
                  type="button"
                  className={styles.reportButton}
                  onClick={() => setIsReportOpen(true)}
                >
                  View fraud report
                </button>
              )}
              <AnalyzeButton
                claimId={header.claimId}
                className={`${styles.analyzeButton} ${showPulse ? styles.pulse : ""}`}
                idleLabel={header.isProcessed ? "Re-run analysis" : "Analyze for fraud"}
                icon={<Icon name="sparkle" size={12} />}
                onAnalyze={onAnalyze}
              />
            </div>
          </div>

          {/* Pure visibility toggle — all tab content came from one fetch. */}
          <TabBar
            tabs={claim.tabs}
            activeId={claim.activeTab}
            onChange={claim.setActiveTab}
            label="Claim sections"
          />

          {claim.activeTab === "overview" && (
            <ClaimOverview
              sections={claim.overviewSections}
              isEditing={claim.isEditing}
              drafts={claim.drafts}
              onDraftChange={claim.changeDraft}
              onSave={claim.save}
              onCancelEdit={claim.cancelEditing}
              saveError={claim.saveError}
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
