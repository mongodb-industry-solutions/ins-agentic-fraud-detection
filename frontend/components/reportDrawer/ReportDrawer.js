"use client";

import { useState } from "react";

import Icon from "@/components/icons/Icons";
import Overlay from "@/components/shared/Overlay";
import StatusPill from "@/components/statusPill/StatusPill";
import styles from "./ReportDrawer.module.css";
import useReportDrawer from "./useReportDrawer";

function ReportSkeleton() {
  return (
    <>
      <div className={styles.section}>
        <div className={styles.scoreRow}>
          <div className={styles.skeletonScore} />
          <div style={{ flex: 1 }}>
            <div className={`${styles.skeletonBlock} ${styles.medium}`} />
            <div className={`${styles.skeletonBlock} ${styles.short}`} />
          </div>
        </div>
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonBlock} ${styles.short}`} />
        <div className={styles.skeletonBlock} />
        <div className={`${styles.skeletonBlock} ${styles.medium}`} />
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonBlock} ${styles.short}`} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
    </>
  );
}

function DecisionSection({ decision, isSubmitting, onDecide }) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");

  // Past decisions and the action buttons are mutually exclusive: if a decision
  // exists, the drawer must not offer to make it again.
  if (decision.state !== "pending") {
    const verb = decision.state === "confirmed" ? "Confirmed as fraud" : "Dismissed";
    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Your decision</span>
        <p className={styles.decisionStatement}>
          {verb} by {decision.reviewedBy || "a reviewer"}
          {decision.reviewedAtLabel && (
            <>
              {" on "}
              <span className={styles.mono}>{decision.reviewedAtLabel}</span>
            </>
          )}
          .
        </p>
        {decision.dismissReason && (
          <p className={styles.decisionReason}>Reason given: {decision.dismissReason}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Your decision</span>
      <div className={styles.decisionActions}>
        <button
          type="button"
          className={styles.confirmButton}
          disabled={isSubmitting}
          onClick={() => onDecide("CONFIRMED_FRAUD")}
        >
          Confirm fraud
        </button>
        <button
          type="button"
          className={styles.outlineButton}
          disabled={isSubmitting}
          onClick={() => setIsDismissing(true)}
        >
          Dismiss
        </button>
      </div>

      {/* Dismissing does not submit on the first click — the reason is required,
          so the field is gated in front of the submission. */}
      {isDismissing && (
        <div className={styles.dismissForm}>
          <label className={styles.label} htmlFor="dismissReason">
            Reason for dismissal (required)
          </label>
          <input
            id="dismissReason"
            className={styles.input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this claim not fraudulent?"
            autoFocus
          />
          <div className={styles.decisionActions}>
            <button
              type="button"
              className={styles.outlineButton}
              disabled={!reason.trim() || isSubmitting}
              onClick={() => onDecide("DISMISSED", reason.trim())}
            >
              Submit dismissal
            </button>
            <button
              type="button"
              className={styles.outlineButton}
              onClick={() => setIsDismissing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportDrawer({ claimId, onClose, onViewClaim }) {
  const { report, isLoading, error, decisionError, isSubmitting, decide } = useReportDrawer(claimId);

  // Escape-to-close, click-outside-to-close and the body-scroll lock all live
  // in Overlay — the drawer and the fraud-pattern modals share one backdrop.
  const openSimilarClaim = (similarClaimId) => {
    onClose();
    onViewClaim?.(similarClaimId);
  };

  return (
    <Overlay open onClose={onClose} variant="drawer" label="Fraud report">
      <aside className={styles.drawer}>
        <div className={styles.header}>
          <div className={styles.headerMain}>
            <div className={styles.headerTop}>
              <span className={styles.claimId}>{claimId}</span>
              {report && <StatusPill statusKey={report.statusKey} />}
            </div>
            <span className={styles.subline}>
              {report ? (
                <>
                  {report.customerName} · {report.claimType}
                  {report.scoredAtLabel && (
                    <>
                      {" · scored "}
                      <span className={styles.mono}>{report.scoredAtLabel}</span>
                      {` by ${report.scoredBy}`}
                    </>
                  )}
                </>
              ) : (
                "Loading fraud report…"
              )}
            </span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.scroll}>
          {isLoading && <ReportSkeleton />}

          {!isLoading && error && (
            <div className={styles.section}>
              <p className={styles.rationale}>Could not load this report: {error}</p>
            </div>
          )}

          {!isLoading && report && (
            <>
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Fraud score</span>
                <div className={styles.scoreRow}>
                  <span className={styles.scoreChip}>{report.scoreLabel}</span>
                  <span className={styles.scoreNotes}>
                    {report.cappingNote && <span>{report.cappingNote}</span>}
                    <span>{report.patternsNote}</span>
                  </span>
                </div>
              </div>

              {report.steps.length > 0 && (
                <div className={styles.section}>
                  <span className={styles.sectionTitle}>How the agent got here</span>
                  {report.steps.map((step) => (
                    <div key={step.id} className={styles.step}>
                      <span className={styles.stepDot}>
                        <Icon name="check" size={9} />
                      </span>
                      {step.label}
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.section}>
                <span className={styles.sectionTitle}>
                  Matched patterns ({report.matchedPatterns.length})
                </span>
                {report.matchedPatterns.map((pattern) => (
                  <div key={pattern.id} className={styles.patternRow}>
                    <span className={styles.points}>{pattern.points}</span>
                    <span className={styles.patternBody}>
                      <span className={styles.patternHead}>
                        <span className={styles.patternName}>{pattern.name}</span>
                        <span className={styles.typeBadge}>{pattern.typeLabel}</span>
                      </span>
                      {pattern.rationale && (
                        <span className={styles.rationale}>{pattern.rationale}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Omitted entirely when there is no similarity evidence. */}
              {report.similarClaims.length > 0 && (
                <div className={styles.section}>
                  <span className={styles.sectionTitle}>Similar historical claims</span>
                  {report.similarClaims.map((similar) => (
                    <div key={similar.claimId} className={styles.similarRow}>
                      <span className={styles.similarity}>{similar.similarityLabel}</span>
                      <span className={styles.similarReason}>{similar.reason}</span>
                      <button
                        type="button"
                        className={styles.similarLink}
                        onClick={() => openSimilarClaim(similar.claimId)}
                      >
                        {similar.claimId}
                      </button>
                      <StatusPill statusKey={similar.statusKey} />
                    </div>
                  ))}
                </div>
              )}

              <DecisionSection
                decision={report.decision}
                isSubmitting={isSubmitting}
                onDecide={decide}
              />
              {decisionError && (
                <p className={styles.rationale} role="alert">
                  The agent could not record the decision: {decisionError}
                </p>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.disabledButton} disabled title="Coming soon">
            Download report
          </button>
          <span className={styles.footerSpacer} />
          <button type="button" className={styles.outlineButton} onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </Overlay>
  );
}
