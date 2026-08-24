import {
  MAX_SCORE,
  STATUS,
  STATUS_LABEL,
  humanizeEnum,
  toCustomerName,
  toMonoDateFull,
  toMoney,
  toMonoTimestamp,
  toScoreLabel,
} from "./claimsPresenter";
import { toCoverageRows } from "./policiesPresenter";
import {
  CHANNELS,
  CLAIM_STATUSES,
  EDITABLE_FIELDS,
  PAYMENT_METHODS,
} from "./const/claimFields";

/**
 * One get_claim_detail document -> the whole claim view.
 *
 * Field paths here follow the live backend documents (accidentLocation,
 * driverSnapshot, policy.premium.*, SCREAMING_SNAKE enums), not a flattened
 * ideal shape. Every tab's content comes off this single response, which is
 * why tab switching is a visibility toggle and never a refetch.
 */

/**
 * A label/value cell.
 *
 * `editableKey` is what makes a cell editable, and only the ten fields
 * ClaimUpdateRequest whitelists ever get one — never anything under `fraud`.
 * `inputType` comes from EDITABLE_FIELDS so the control matches the field's
 * real type, and `rawValue` is what the editor binds to (the displayed `value`
 * is formatted for reading: "Yes", "$1,200", "Mobile app").
 */
const cell = (label, value, options = {}) => {
  const editableKey = options.editableKey || null;
  return {
    id: label,
    label,
    value: value === null || value === undefined || value === "" ? "—" : String(value),
    isMono: options.mono || false,
    editableKey,
    inputType: editableKey ? EDITABLE_FIELDS[editableKey] || "text" : null,
    rawValue: options.rawValue ?? null,
    selectOptions: options.selectOptions || null,
    span: options.span || 1,
    hint: options.hint || null,
  };
};

/** Keeps a stored value that is not in the known list from vanishing. */
const withCurrent = (values, current) =>
  current && !values.includes(current) ? [...values, current] : values;

const enumOptions = (values, current, disabledValues = []) =>
  withCurrent(values, current).map((value) => ({
    value,
    label: humanizeEnum(value),
    disabled: disabledValues.includes(value),
  }));

const yesNo = (value) => (value === null || value === undefined ? null : value ? "Yes" : "No");

const place = (location) =>
  location ? [location.city, location.state].filter(Boolean).join(", ") : null;

/**
 * Status is derived from the fraud sub-object, not from claimStatus — the
 * backend's claimStatus tracks lifecycle (OPEN/CLOSED) while the four states
 * this UI shows are about the fraud assessment.
 */
/** Scored, but no human decision recorded yet — the close guard's condition. */
function isAwaitingDecision(claim) {
  const fraud = claim.fraud || {};
  return fraud.processed === true && (fraud.fraudFlag === null || fraud.fraudFlag === undefined);
}

export function toClaimStatusKey(claim) {
  const fraud = claim.fraud || {};
  if (fraud.fraudFlag === true) return STATUS.FLAGGED;
  if (!fraud.processed) return STATUS.UNPROCESSED;
  if (fraud.fraudFlag === false) return STATUS.CLEARED;
  return STATUS.PENDING;
}

export function toClaimHeader(claim) {
  const fraud = claim.fraud || {};
  const statusKey = toClaimStatusKey(claim);
  // Any CLOSED* lifecycle counts as closed. The live data also carries
  // CLOSED_DENIED, which is just as final as CLOSED — treating only the exact
  // string "CLOSED" as closed would leave denied claims editable.
  const isClosed = (claim.claimStatus || "").startsWith("CLOSED");

  return {
    claimId: claim.claimId,
    complexityLabel: (claim.complexity || "SIMPLE").toLowerCase() === "complex" ? "Complex" : "Simple",
    statusKey,
    statusLabel: STATUS_LABEL[statusKey],
    subline: [toCustomerName(claim.customer) || claim.customerName, claim.policyId]
      .filter(Boolean)
      .join(" · "),
    facts: [
      cell("Claim type", humanizeEnum(claim.claimType)),
      cell("Coverage", humanizeEnum(claim.coverageType)),
      cell("Opened", toMonoDateFull(claim.claimDate), { mono: true }),
      cell("Claim amount", toMoney(claim.claimAmount), { mono: true }),
    ],
    // Absent — not dashed — before the claim is processed, so the header can't
    // imply a score exists in some form before one does.
    scoreLabel: fraud.processed ? toScoreLabel(fraud.computedScore) : null,
    isProcessed: Boolean(fraud.processed),
    // Lifecycle is a separate axis from the fraud status above: a claim can be
    // CLOSED and flagged at the same time. It drives which actions are allowed.
    isClosed: isClosed,
    // Keeps the distinction visible: "Closed — denied" is not the same outcome
    // as a plain close, even though both block the same actions.
    lifecycleLabel: isClosed ? humanizeEnum(claim.claimStatus).replace("Closed denied", "Closed — denied") : "Open",
    closedAtLabel: isClosed ? toMonoDateFull(claim.closedAt) : null,
  };
}

/** Overview: accident details, then the claim-time snapshot block. */
export function toOverviewSections(claim) {
  const driver = claim.driverSnapshot || {};
  const vehicle = claim.vehicleSnapshot || {};
  const customerSnapshot = claim.customerSnapshot || {};

  return [
    {
      id: "accident",
      title: "Accident details",
      caption: null,
      cells: [
        // Not editable: derived or immutable facts of the incident itself.
        cell("Accident time", claim.accidentTime, { mono: true }),
        cell("Location", place(claim.accidentLocation)),
        cell("Report delay", claim.delayDays != null ? `${claim.delayDays} days` : null),
        cell("Police report", yesNo(claim.policeReport), {
          editableKey: "policeReport",
          rawValue: Boolean(claim.policeReport),
        }),
        cell("Witnesses", claim.witnessCount, {
          editableKey: "witnessCount",
          rawValue: claim.witnessCount ?? "",
        }),
        cell("Repair shop", claim.repairShop, {
          editableKey: "repairShop",
          rawValue: claim.repairShop ?? "",
        }),
        cell("Adjuster ID", claim.adjusterId, {
          mono: true,
          editableKey: "adjusterId",
          rawValue: claim.adjusterId ?? "",
        }),
        cell("Payment method", humanizeEnum(claim.paymentMethod), {
          editableKey: "paymentMethod",
          rawValue: claim.paymentMethod ?? "",
          selectOptions: enumOptions(PAYMENT_METHODS, claim.paymentMethod),
        }),
        cell("Channel", humanizeEnum(claim.channel), {
          editableKey: "channel",
          rawValue: claim.channel ?? "",
          selectOptions: enumOptions(CHANNELS, claim.channel),
        }),
      ],
    },
    {
      id: "handling",
      title: "Handling & outcome",
      caption: null,
      cells: [
        cell("Claim status", humanizeEnum(claim.claimStatus), {
          editableKey: "claimStatus",
          rawValue: claim.claimStatus ?? "",
          // Mirrors close_claim's guard: a scored claim awaiting a decision
          // cannot be moved to a closed state, so those options are refused
          // here rather than sent and bounced.
          selectOptions: enumOptions(
            CLAIM_STATUSES,
            claim.claimStatus,
            isAwaitingDecision(claim) ? CLAIM_STATUSES.filter((s) => s.startsWith("CLOSED")) : []
          ),
          hint: isAwaitingDecision(claim)
            ? "Closing is blocked until the fraud recommendation is confirmed or dismissed."
            : null,
        }),
        cell("Paid amount", toMoney(claim.paidAmount), {
          mono: true,
          editableKey: "paidAmount",
          rawValue: claim.paidAmount ?? "",
        }),
        cell("Escalated", yesNo(claim.escalated), {
          editableKey: "escalated",
          rawValue: Boolean(claim.escalated),
        }),
        cell("Description", claim.description, {
          editableKey: "description",
          rawValue: claim.description ?? "",
          // Free prose needs the full row width, not a third of it.
          span: 3,
        }),
      ],
    },
    {
      id: "snapshot",
      title: "Claim-time snapshots",
      // Flagged inline because these deliberately disagree with the Customer
      // tab's live values, and that difference is correct, not a data bug.
      caption: "— captured at filing, not live values",
      cells: [
        cell("Driver age", driver.age),
        cell("License years", driver.licenseYears),
        cell(
          "Vehicle",
          [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || null
        ),
        cell("Vehicle value", toMoney(vehicle.value), { mono: true }),
        cell("Prior claims at filing", customerSnapshot.numPreviousClaims),
        cell("Policies held at filing", customerSnapshot.numPolicies),
      ],
    },
  ];
}

export function toPolicyTab(claim) {
  const policy = claim.policy || {};
  const period = policy.effectivePeriod || {};
  const premium = policy.premium || {};
  // Both dates carry the year: a term is commonly the same day two
  // years apart, which reads as nonsense without it.
  const dates = [period.startDate, period.endDate].filter(Boolean).map(toMonoDateFull);

  return {
    cells: [
      cell("Policy ID", policy.policyId, { mono: true }),
      cell("Type", humanizeEnum(policy.policyType)),
      cell("Status", humanizeEnum(policy.status)),
      cell("Effective period", dates.length ? dates.join(" – ") : null, { mono: true }),
      cell("Annual premium", toMoney(premium.annualPremium), { mono: true }),
      cell("Outstanding balance", toMoney(premium.outstandingBalance), { mono: true }),
    ],
    // Same row shape the shared CoveragesTable expects, so the claim view's
    // Policy tab and Policy Detail render through one component.
    coverages: toCoverageRows(policy.coverages),
  };
}

export function toCustomerTab(claim) {
  const customer = claim.customer || {};
  return {
    cells: [
      cell("Name", toCustomerName(customer)),
      cell(
        "Customer since",
        customer.customerSince ? String(customer.customerSince).slice(0, 4) : null,
        { mono: true }
      ),
      cell("Location", place(customer.address)),
      cell("Policies held", customer.numPolicies),
      cell("Previous claims", customer.numPreviousClaims),
      cell("License years", customer.licenseYears),
    ],
  };
}

/* The backend emits three link reasons: "Same customer", "Same repair shop
   (X)" and "Shared fraud pattern(s): ...". Each gets its own glyph. */
function toReasonIcon(reason) {
  const text = reason.toLowerCase();
  if (text.includes("customer")) return "users";
  if (text.includes("pattern")) return "activity";
  return "file";
}

/** Linked claims carry their own reason lines, each with its own icon. */
export function toLinkedClaims(response) {
  return (response?.linked || []).map((linked, index) => ({
    id: linked.claimId,
    claimId: linked.claimId,
    numberLabel: String(index + 1),
    customerName: linked.customerName || "Unknown customer",
    reasons: (linked.linkReasons || []).map((reason) => ({
      text: reason,
      icon: toReasonIcon(reason),
    })),
  }));
}

/**
 * One decision trace -> everything the audit tab renders for that run.
 *
 * A trace holds four different kinds of information and they are kept apart
 * here rather than flattened into a list of sentences:
 *
 *   what triggered the run  — triggerType, triggeredBy, batchId
 *   what the agent found    — score, band, matchedPatterns, steps, agentSummary
 *   what the claim looked
 *   like at the time        — contextSnapshot
 *   what the human did      — humanDecision / outcome
 *
 * `steps` is the per-pattern evidence and is a SUBSET of `matchedPatterns` —
 * four patterns can match while only two carry a recorded detail. So the
 * pattern list is built from `matchedPatterns` (authoritative for what fired)
 * and enriched from `steps` where a detail exists, instead of rendering `steps`
 * alone and silently dropping the rest.
 *
 * Field fallbacks exist because two trace shapes are in the data: the
 * established one below, and the agent's own writes which use `subjectRef` and
 * `occurredAt`. Reading both means an agent-written trace still appears rather
 * than vanishing on a key name.
 */
function toAuditEntry(record, index) {
  const claimId = record.claimId || record.subjectRef || null;
  const at = record.createdAt || record.triggeredAt || record.occurredAt || null;
  const context = record.contextSnapshot || {};
  const outcome = record.outcome || {};
  const human = record.humanDecision || null;

  const computedScore = record.computedScore ?? context.computedScore ?? outcome.proposedScore ?? null;
  const rawScore = record.rawScore ?? context.rawScore ?? outcome.rawScore ?? null;
  const band = context.band || outcome.band || null;

  const isAgentRun = computedScore != null || Boolean(record.matchedPatterns);

  // A cap is worth stating explicitly: a claim at 12/12 that raw-scored 18 is a
  // different fact from one that scored exactly 12.
  const capApplied =
    outcome.capApplied === true || (rawScore != null && computedScore != null && rawScore > computedScore);

  const stepsByPattern = new Map(
    // Optional-chained: a trace can carry narration strings in `steps` instead
    // of pattern objects, and those have no patternId to index by.
    (record.steps || []).filter((step) => step?.patternId).map((step) => [step.patternId, step])
  );

  // Counted from the raw array but rendered only from usable entries: the
  // offline fixture carries `new Array(7)` as shorthand for "seven matched, no
  // detail", so a row list built without this guard dereferences undefined.
  const matchedCount = (record.matchedPatterns || []).length;

  const patterns = (record.matchedPatterns || []).filter((pattern) => pattern?.patternId).map((pattern) => {
    const step = stepsByPattern.get(pattern.patternId) || {};
    return {
      patternId: pattern.patternId,
      name: pattern.patternName || pattern.name || pattern.patternId,
      weight: pattern.weight ?? step.weight ?? null,
      typeLabel: step.patternType === "HISTORICAL_SIMILARITY" ? "Similarity" : step.patternType ? "Rule" : null,
      severity: step.severity || null,
      // The comparison that actually fired, e.g. "claimAmount=35000 > 25000".
      detail: step.detail || null,
      similarityLabel: step.similarity != null ? `${Math.round(step.similarity * 100)}%` : null,
    };
  });

  const decision = human?.decision || outcome.finalDecision || null;
  const decidedAt = human?.decidedAt || outcome.decidedAt || null;

  return {
    id: record.traceId || `${claimId || "record"}-${index}`,
    traceId: record.traceId || null,
    isAgentRun,
    title: isAgentRun ? "Fraud analysis run" : humanizeEnum(record.eventType) || "Claim event",
    timestampLabel: toMonoTimestamp(at),

    scoreLabel: computedScore != null ? `${Math.round(computedScore)}` : null,
    scoreOutOf: computedScore != null ? `${Math.round(computedScore)} / ${MAX_SCORE}` : null,
    bandLabel: band ? humanizeEnum(band) : null,
    capNote: capApplied ? `Capped from a raw total of ${Math.round(rawScore)}` : null,

    // Facts about the run itself, as label/value pairs so the component does no
    // formatting of its own.
    runFacts: [
      record.triggeredBy ? { label: "Triggered by", value: record.triggeredBy, mono: true } : null,
      record.triggerType
        ? { label: "Trigger", value: humanizeEnum(record.triggerType), mono: false }
        : null,
      record.batchId ? { label: "Batch", value: record.batchId, mono: true } : null,
      context.claimAmount != null
        ? { label: "Claim amount", value: toMoney(context.claimAmount), mono: true }
        : null,
      context.complexity
        ? { label: "Complexity", value: humanizeEnum(context.complexity), mono: false }
        : null,
    ].filter(Boolean),

    summary: record.agentSummary || null,
    patterns,
    patternsNote:
      matchedCount > 0
        ? `${matchedCount} pattern${matchedCount === 1 ? "" : "s"} matched`
        : "No patterns matched",

    decision: decision
      ? {
          // Same status vocabulary as every other fraud state in the app, so the
          // pill here means what it means everywhere else.
          statusKey: decision.startsWith("CONFIRM") ? STATUS.FLAGGED : STATUS.CLEARED,
          label: decision.startsWith("CONFIRM") ? "Confirmed fraud" : "Dismissed",
          byLabel: human?.decidedBy || outcome.reviewedBy || null,
          atLabel: decidedAt ? toMonoTimestamp(decidedAt) : null,
          reasoning: human?.reasoning || outcome.reason || outcome.notes || null,
          siuReferred: human?.siuReferred === true || outcome.siuReferred === true,
        }
      : null,
  };
}

/** Audit timeline, newest first as the API returns it. */
export function toAuditTimeline(response) {
  return (response?.records || []).map(toAuditEntry);
}

/** Tab bar. The linked count only appears when there is something to count. */
export function toClaimTabs(linkedCount) {
  return [
    { id: "overview", label: "Overview" },
    { id: "policy", label: "Policy" },
    { id: "customer", label: "Customer" },
    {
      id: "linked",
      label: linkedCount > 0 ? `Linked claims (${linkedCount})` : "Linked claims",
    },
    { id: "audit", label: "Audit trail" },
  ];
}
