"use client";

import { useState } from "react";

import FactGrid from "@/components/factGrid/FactGrid";
import Icon from "@/components/icons/Icons";
import { humanizeEnum, toMoney, toMonoDateFull } from "@/lib/claimsPresenter";
import styles from "./FraudReportContent.module.css";

/**
 * The fraud assessment report, rendered identically wherever it appears: live in
 * the analysis modal's complete phase, or later in the "View report" drawer. The
 * overlay owns its geometry; this component owns only the document.
 *
 * Nothing here is invented client-side. Every string comes from the payload —
 * including `score.bandLabel`, which is *not* derived from thresholds here on
 * purpose: band cutoffs live server-side so they can be recalibrated without a
 * frontend deploy, and hardcoding the old capped-scale thresholds against a new
 * uncapped score is exactly the bug the migration notes warned about.
 */

/* One severity convention, three tiers, shared by triggered rules and
   supporting evidence. Nothing else defines its own tiers. */
const SEVERITY_DOT = {
  CRITICAL: styles.sevCritical,
  WARNING: styles.sevWarning,
  INFO: styles.sevInfo,
  HIGH: styles.sevCritical,
  MEDIUM: styles.sevWarning,
  LOW: styles.sevInfo,
};

/** `humanizeEnum` preserves 4-letter enums verbatim, which would render HIGH
 *  and INFO in caps beside a title-cased Medium. Severity labels get their own
 *  formatter so the three tiers read as one set. */
function severityLabel(level) {
  if (!level) return "";
  return level.charAt(0) + level.slice(1).toLowerCase();
}

function SeverityDot({ level }) {
  return <div className={`${styles.sevDot} ${SEVERITY_DOT[level] ?? styles.sevWarning}`} />;
}

function ReportHeader({ claimId, customerName, claimType, traceId, onClose }) {
  return (
    <div className={styles.header}>
      <div>
        <div className={styles.title}>
          Fraud assessment <span className={styles.claimId}>{claimId}</span>
        </div>
        <div className={styles.sub}>
          {customerName} · {humanizeEnum(claimType)}
        </div>
        {traceId && <div className={styles.traceId}>Trace {traceId}</div>}
      </div>
      {onClose && (
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * A deliberately self-contained recap, redundant with the claim view's Overview
 * tab. A fraud report has to read in isolation — and eventually export as a
 * standalone document — so it cannot assume the reader has the claim open too.
 */
function ClaimSummarySection({ summary }) {
  const { vehicle } = summary;

  const cells = [
    ["Policy", `${summary.policyId} · ${humanizeEnum(summary.policyStatus)}`, true],
    ["Claim type", `${humanizeEnum(summary.claimType)} · ${humanizeEnum(summary.coverageType)}`],
    ["Claim amount", toMoney(summary.claimAmount)],
    ["Paid amount", toMoney(summary.paidAmount)],
    ["Status", humanizeEnum(summary.claimStatus)],
    ["Complexity", humanizeEnum(summary.complexity)],
    [
      "Vehicle",
      `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${toMoney(vehicle.value)}`,
    ],
    // Its own row rather than appended to the vehicle line: a VIN is long
    // enough to wreck that row's readability.
    ["VIN", vehicle.vin, true],
    ["Repair shop", summary.repairShop],
    ["Adjuster", summary.adjusterId, true],
    ["Loss date", toMonoDateFull(summary.lossDate), true],
    [
      "Report date",
      `${toMonoDateFull(summary.reportDate)} · ${summary.reportDelayDays} delay days`,
      true,
    ],
    [
      "Police report / witnesses",
      `${summary.policeReportFiled ? "Yes" : "No"} / ${summary.witnessCount}`,
    ],
  ].map(([label, value, isMono]) => ({
    id: label,
    label,
    value: value ?? "—",
    isMono: Boolean(isMono),
  }));

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Claim summary</div>
      {/* The shared 3-column grid from the Overview/Policy/Customer tabs, not a
          second grid implementation. Read-only: no cell carries an editableKey. */}
      <FactGrid cells={cells} />
    </div>
  );
}

function ScoreSection({ score, triggeredRules, totalPatternsEvaluated }) {
  const arithmetic = triggeredRules.map((rule) => `${rule.patternId}(${rule.weight})`).join(" + ");

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Fraud score</div>
      <div className={styles.scoreSummary}>
        <div className={styles.scoreBig}>
          <div className={styles.scoreBigNum}>{score.computedScore}</div>
          <div className={styles.scoreBigMax}>/ {score.maxScore}</div>
        </div>
        <div>
          <span className={styles.capNote}>
            {triggeredRules.length} pattern{triggeredRules.length === 1 ? "" : "s"} matched
            {/* Omitted rather than guessed when the run did not report a total. */}
            {totalPatternsEvaluated ? ` out of ${totalPatternsEvaluated} active patterns evaluated.` : "."}
          </span>
          <span className={styles.bandBadge}>
            {score.bandLabel} band — {score.bandDescriptor}
          </span>
          <div className={styles.arithmeticLine}>
            <b>{score.computedScore}</b> = {arithmetic || "no patterns matched"}.{" "}
            {score.capped ? `Capped from raw score ${score.rawScore}.` : "No cap applied."}
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleDetailRow({ rule, isStrongestRule }) {
  const confirmedPct = Math.round((rule.confirmedFraudRate ?? 0) * 100);

  return (
    <div className={styles.ruleRow}>
      <SeverityDot level={rule.severity} />
      <div className={styles.ruleBody}>
        <div className={styles.ruleTop}>
          <span className={styles.ruleName}>
            {rule.patternId} — {rule.patternName}
          </span>
          <span className={styles.weightChip}>+{rule.weight}</span>
          <span className={styles.badge}>{severityLabel(rule.severity)}</span>
          {rule.patternType === "HISTORICAL_SIMILARITY" && (
            <span className={styles.badgeMuted}>Similarity</span>
          )}
        </div>
        <div className={styles.confirmedRate}>
          Confirmed fraud rate: {confirmedPct}% ({rule.confirmedCount} of {rule.timesTriggered}{" "}
          triggers confirmed)
          {isStrongestRule && " — the strongest-performing rule in the book"}
        </div>
        <div className={styles.narrative}>{rule.narrative}</div>
      </div>
    </div>
  );
}

function TriggeredRulesSection({ triggeredRules }) {
  if (!triggeredRules?.length) return null;

  // Computed once here rather than per row, and only credited when a rule is
  // uniquely the best — calling two tied rules "the strongest" reads as a bug.
  const rates = triggeredRules.map((rule) => rule.confirmedFraudRate ?? 0);
  const best = Math.max(...rates);
  const isUnique = rates.filter((rate) => rate === best).length === 1 && best > 0;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        Triggered patterns ({triggeredRules.length})
      </div>
      {triggeredRules.map((rule) => (
        <RuleDetailRow
          key={rule.patternId}
          rule={rule}
          isStrongestRule={isUnique && (rule.confirmedFraudRate ?? 0) === best}
        />
      ))}
    </div>
  );
}

function PrecedentSection({ precedent, onOpenClaim }) {
  // Omitted entirely rather than rendering a "nothing found" placeholder.
  if (!precedent || precedent.status === "NONE") return null;

  const isDegraded =
    precedent.status === "DEGRADED_WITH_MATCH" || precedent.status === "DEGRADED_NO_MATCH";

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Similar historical claims — direct precedent</div>

      {isDegraded && (
        <div className={styles.degradedBanner}>
          <span className={styles.degradedIcon}>
            <Icon name="alert" size={14} />
          </span>
          <span>
            The vector-based similar-claims search was unavailable
            {precedent.degradedReason ? ` (${precedent.degradedReason})` : ""}.
            {precedent.status === "DEGRADED_WITH_MATCH"
              ? " The match below comes from a deterministic same-customer/same-vehicle/same-shop lookup instead — direct precedent, not a similarity score."
              : " No deterministic direct match was found either."}
          </span>
        </div>
      )}

      {precedent.comparison && (
        <table className={styles.precedentTable}>
          <thead>
            <tr>
              <th>Field</th>
              <th>
                {onOpenClaim ? (
                  <button
                    type="button"
                    className={styles.priorLink}
                    onClick={() => onOpenClaim(precedent.comparison.priorClaimId)}
                  >
                    {precedent.comparison.priorClaimId}
                  </button>
                ) : (
                  precedent.comparison.priorClaimId
                )}{" "}
                (prior)
              </th>
              <th>Current</th>
            </tr>
          </thead>
          <tbody>
            {precedent.comparison.fields.map((field) => (
              <tr key={field.label}>
                <td className={styles.fieldLabel}>{field.label}</td>
                <td>
                  {/* A prior confirmed-fraud outcome means the same thing as a
                      flagged pill, so it gets the same solid treatment. */}
                  {field.label.toLowerCase() === "outcome" ? (
                    <span className={styles.outcomeChip}>{field.priorValue}</span>
                  ) : (
                    field.priorValue
                  )}
                </td>
                <td>{field.currentValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Broader than the triggered-pattern list above it: this includes contextual
 * observations that map to no `fraud_patterns` document at all. It is agent
 * output in its own right, never derived from `triggeredRules` — deriving it
 * would silently drop every mitigating INFO signal.
 */
function SupportingEvidenceSection({ evidence }) {
  if (!evidence?.length) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Supporting evidence</div>
      {evidence.map((item) => (
        <div key={`${item.signal}-${item.severity}`} className={styles.evidenceRow}>
          <SeverityDot level={item.severity} />
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceSignal}>{item.signal}</div>
            <div className={styles.evidenceDetail}>{item.detail}</div>
          </div>
          {/* Uppercased by CSS, so the raw enum is what belongs here. */}
          <div className={styles.evidenceSevLabel}>{item.severity}</div>
        </div>
      ))}
    </div>
  );
}

function VerdictBanner({ verdict }) {
  const tone =
    verdict.label === "FRAUD"
      ? ""
      : verdict.label === "NOT_FRAUD"
        ? styles.notFraud
        : styles.uncertain;

  return (
    <div className={styles.verdictSection}>
      <div className={`${styles.verdictBanner} ${tone}`}>
        <div className={styles.verdictHeadline}>
          {verdict.label.replace("_", " ")}
          <span className={styles.verdictConfidence}>— {verdict.confidence} confidence</span>
        </div>
        <div className={styles.verdictReason}>{verdict.reason}</div>
        <div className={styles.verdictRecommendation}>
          Recommendation: {verdict.recommendation}
        </div>
      </div>
    </div>
  );
}

/**
 * SIU referral is modelled as an attribute of a confirmation, not a fourth
 * decision path: the checkbox only means anything alongside "Confirm fraud", is
 * pre-checked from `verdict.recommendsSIU`, and rides along on the same submit.
 */
function DecisionSection({ claimId, decision, verdict, onDecide }) {
  const [siuChecked, setSiuChecked] = useState(Boolean(verdict?.recommendsSIU));
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (payload) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onDecide?.(payload);
    } catch (submitError) {
      setError(submitError.message || "Could not record the decision.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // A past decision and the action buttons are mutually exclusive: if a decision
  // exists, the report must not offer to make it again.
  if (decision?.state && decision.state !== "pending") {
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Decision</div>
        <div className={styles.decisionMade}>
          {decision.state === "confirmed"
            ? `Confirmed as fraud by ${decision.reviewedBy || "a reviewer"}${
                decision.reviewedAt ? ` on ${toMonoDateFull(decision.reviewedAt)}` : ""
              }${decision.siuReferred ? " · Referred to SIU" : ""}`
            : `Dismissed by ${decision.reviewedBy || "a reviewer"}${
                decision.reviewedAt ? ` on ${toMonoDateFull(decision.reviewedAt)}` : ""
              }${decision.dismissReason ? ` — "${decision.dismissReason}"` : ""}`}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Your decision</div>
      <div className={styles.decisionButtons}>
        <button
          type="button"
          className={styles.btnConfirm}
          disabled={isSubmitting}
          onClick={() => submit({ decision: "CONFIRMED_FRAUD", siuReferred: siuChecked })}
        >
          Confirm fraud
        </button>
        <button
          type="button"
          className={styles.btnDismiss}
          disabled={isSubmitting}
          onClick={() => setIsDismissing(true)}
        >
          Dismiss
        </button>
      </div>

      <div className={styles.siuRow}>
        <input
          type="checkbox"
          id={`siu-${claimId}`}
          checked={siuChecked}
          onChange={(event) => setSiuChecked(event.target.checked)}
        />
        <label htmlFor={`siu-${claimId}`}>
          Also refer to SIU for investigation
          {verdict?.recommendsSIU && " (recommended)"}
        </label>
      </div>

      {/* Dismissing never submits on the first click: the reason is required, so
          the field is gated in front of the submission. */}
      {isDismissing && (
        <div className={styles.dismissForm}>
          <textarea
            className={styles.formTextarea}
            placeholder="Reason for dismissal (required)"
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            autoFocus
          />
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!dismissReason.trim() || isSubmitting}
            onClick={() => submit({ decision: "DISMISSED", dismissReason: dismissReason.trim() })}
          >
            Submit dismissal
          </button>
        </div>
      )}

      {error && <div className={styles.decisionError}>{error}</div>}
    </div>
  );
}

export default function FraudReportContent({
  report,
  totalPatternsEvaluated,
  onClose,
  onOpenClaim,
  onDecide,
}) {
  if (!report) return null;

  return (
    <div className={styles.report}>
      <ReportHeader
        claimId={report.claimId}
        customerName={report.claimSummary.customerName}
        claimType={report.claimSummary.claimType}
        traceId={report.traceId}
        onClose={onClose}
      />
      <ClaimSummarySection summary={report.claimSummary} />
      <ScoreSection
        score={report.score}
        triggeredRules={report.triggeredRules ?? []}
        totalPatternsEvaluated={totalPatternsEvaluated}
      />
      <TriggeredRulesSection triggeredRules={report.triggeredRules ?? []} />
      <PrecedentSection precedent={report.precedent} onOpenClaim={onOpenClaim} />
      <SupportingEvidenceSection evidence={report.supportingEvidence} />
      <VerdictBanner verdict={report.verdict} />
      <DecisionSection
        claimId={report.claimId}
        decision={report.decision}
        verdict={report.verdict}
        onDecide={onDecide}
      />
      <div className={styles.footer}>
        <button type="button" className={styles.disabledButton} disabled title="Coming soon">
          Download report
        </button>
        <span className={styles.footerSpacer} />
      </div>
    </div>
  );
}
