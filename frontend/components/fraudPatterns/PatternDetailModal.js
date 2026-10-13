"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/icons/Icons";
import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";
import Overlay from "@/components/shared/Overlay";
import { useToast } from "@/components/shared/ToastProvider";
import { PATTERN_TYPE } from "@/lib/fraudPatternsPresenter";
import EditPatternForm from "./EditPatternForm";
import styles from "./PatternDetailModal.module.css";
import useFraudPatternDetail from "./useFraudPatternDetail";

/** How many matched claims the modal shows before deferring to the full list. */
const CLAIM_PREVIEW_LIMIT = 10;

function DetailSkeleton() {
  return (
    <>
      <div className={styles.section}>
        <div className={`${styles.skeletonBlock} ${styles.medium}`} />
        <div className={`${styles.skeletonBlock} ${styles.short}`} />
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonBlock} ${styles.short}`} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonBlock} ${styles.short}`} />
        <div className={styles.skeletonBlock} />
      </div>
    </>
  );
}

/* The matched-claims list uses the app's real ScoreChip and StatusPill — the
   same chip and pill every other claim reference carries — so a claim reads
   identically here and in the tables it also appears in. */
function MatchedClaimRow({ claim, onClick }) {
  return (
    <button type="button" className={styles.claimRow} onClick={onClick}>
      <ScoreChip value={claim.scoreLabel} />
      <span className={styles.claimId}>{claim.claimId}</span>
      <span className={styles.claimCustomer}>{claim.customerName}</span>
      <span className={styles.claimDate}>{claim.openedLabel}</span>
      <StatusPill statusKey={claim.statusKey} label={claim.statusLabel} />
    </button>
  );
}

export default function PatternDetailModal({
  patternId,
  open,
  onClose,
  onOpenClaim,
  onPatternUpdated,
}) {
  const { detail, isLoading, error, applyUpdate } = useFraudPatternDetail(open ? patternId : null);
  const showToast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [showAllClaims, setShowAllClaims] = useState(false);

  // Opening a different pattern must not land in the previous one's edit form.
  useEffect(() => {
    setIsEditing(false);
    setShowAllClaims(false);
  }, [patternId]);

  const isRule = detail?.patternType === PATTERN_TYPE.RULE;

  const handleSaved = (updatedPattern, updatedFields) => {
    // Both views redraw from the pattern PATCH returned: the modal via the
    // detail hook, the card behind it via the list hook. Neither refetches.
    applyUpdate(updatedPattern);
    onPatternUpdated?.(updatedPattern);
    setIsEditing(false);
    showToast(
      <>
        Saved {updatedFields.length} change{updatedFields.length === 1 ? "" : "s"} to{" "}
        {updatedPattern.name}.
      </>
    );
  };

  return (
    <Overlay open={open} onClose={onClose} variant="centered" label="Fraud pattern detail">
      <div className={styles.panel}>
        {error && (
          <div className={styles.section}>
            <div className={styles.bodyText}>Couldn&apos;t load this pattern: {error}</div>
            <div className={styles.footer}>
              <button type="button" className={styles.btnSm} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {!error && (isLoading || !detail) && <DetailSkeleton />}

        {!error && detail && isEditing && (
          <EditPatternForm
            detail={detail}
            onCancel={() => setIsEditing(false)}
            onSaved={handleSaved}
          />
        )}

        {!error && detail && !isEditing && (
          <>
            <div className={styles.header}>
              <div className={styles.titleRow}>
                <span className={styles.title}>{detail.name}</span>
                <span className={styles.badge}>{detail.typeLabel}</span>
                <span className={styles.badge}>{detail.severity}</span>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Close"
              >
                <Icon name="close" size={13} />
              </button>
            </div>

            {isRule ? (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Conditions <span className={styles.hint}>— combined with AND</span>
                </div>
                {detail.conditions.map((condition, index) => (
                  <div key={`${condition.field}-${index}`} className={styles.conditionRow}>
                    <span className={styles.condField}>{condition.field}</span>
                    <span className={styles.condOp}>{condition.operator}</span>
                    <span className={styles.condVal}>{condition.value}</span>
                  </div>
                ))}

                <div className={styles.sectionTitle} style={{ marginTop: 14 }}>
                  Internal description{" "}
                  <span className={styles.hint}>— not used for semantic search</span>
                </div>
                <div className={styles.bodyText}>{detail.internalDescription}</div>
              </div>
            ) : (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Pattern description{" "}
                  <span className={styles.hint}>— used to generate the embedding</span>
                </div>
                <div className={styles.bodyText}>{detail.embeddingText}</div>

                <div className={styles.sectionTitle} style={{ marginTop: 14 }}>
                  Embedding status
                </div>
                {detail.embeddingPending ? (
                  <span className={styles.pendingTag}>
                    <span className={styles.pdot} />
                    Not available — pending embedding procedure
                  </span>
                ) : (
                  <span className={styles.embedReady}>
                    <Icon name="check" size={11} />
                    Embedding ready
                  </span>
                )}
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Applies to</div>
              <div className={styles.tagList}>
                {[...detail.appliesTo.claimTypes, ...detail.appliesTo.coverageTypes].map((tag) => (
                  <span key={tag} className={styles.tagStatic}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Performance</div>
              <div className={styles.perfGrid}>
                <div>
                  <div className={styles.perfLabel}>Confirmed fraud rate</div>
                  <div className={styles.perfValue}>{detail.confirmedFraudRate}</div>
                  <div className={styles.perfGapNote}>
                    {detail.confirmedCount} of {detail.timesTriggered} matched claims
                  </div>
                </div>
                <div>
                  <div className={styles.perfLabel}>Share of all fraud claims</div>
                  <div className={styles.perfValue}>{detail.shareOfAllFraud.label}</div>
                  <div className={styles.perfGapNote}>{detail.shareOfAllFraud.detail}</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                Claims that matched this pattern ({detail.matchedClaims.length})
              </div>
              {detail.matchedClaims.length === 0 ? (
                <div className={styles.emptyState}>No claims have matched this pattern yet.</div>
              ) : (
                <div className={showAllClaims ? styles.claimListScroll : undefined}>
                  {(showAllClaims
                    ? detail.matchedClaims
                    : detail.matchedClaims.slice(0, CLAIM_PREVIEW_LIMIT)
                  ).map((claim) => (
                    <MatchedClaimRow
                      key={claim.claimId}
                      claim={claim}
                      onClick={() => {
                        onClose();
                        onOpenClaim?.(claim.claimId);
                      }}
                    />
                  ))}
                </div>
              )}
              {detail.matchedClaims.length > CLAIM_PREVIEW_LIMIT && (
                <button
                  type="button"
                  className={styles.viewAllLink}
                  onClick={() => setShowAllClaims((value) => !value)}
                >
                  {showAllClaims
                    ? "Show top " + CLAIM_PREVIEW_LIMIT + " only"
                    : "View all " + detail.matchedClaims.length + " →"}
                </button>
              )}
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.btnSm} onClick={() => setIsEditing(true)}>
                Edit
              </button>
              <button type="button" className={styles.btnSm} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
