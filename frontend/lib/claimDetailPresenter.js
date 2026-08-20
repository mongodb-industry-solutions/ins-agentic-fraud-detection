import {
  STATUS,
  STATUS_LABEL,
  humanizeEnum,
  toCustomerName,
  toMonoDateFull,
  toMonoTimestamp,
  toScoreLabel,
} from "./claimsPresenter";

/**
 * One get_claim_detail document -> the whole claim view.
 *
 * Field paths here follow the live backend documents (accidentLocation,
 * driverSnapshot, policy.premium.*, SCREAMING_SNAKE enums), not a flattened
 * ideal shape. Every tab's content comes off this single response, which is
 * why tab switching is a visibility toggle and never a refetch.
 */

/** A label/value cell. `editableKey` is what makes a cell editable, and only
 *  fields outside the claim's `fraud` sub-object ever get one. */
const cell = (label, value, options = {}) => ({
  id: label,
  label,
  value: value === null || value === undefined || value === "" ? "—" : String(value),
  isMono: options.mono || false,
  editableKey: options.editableKey || null,
});

const money = (amount) =>
  amount === null || amount === undefined
    ? null
    : `$${Number(amount).toLocaleString("en-US")}`;

const yesNo = (value) => (value === null || value === undefined ? null : value ? "Yes" : "No");

const place = (location) =>
  location ? [location.city, location.state].filter(Boolean).join(", ") : null;

/**
 * Status is derived from the fraud sub-object, not from claimStatus — the
 * backend's claimStatus tracks lifecycle (OPEN/CLOSED) while the four states
 * this UI shows are about the fraud assessment.
 */
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
      cell("Claim amount", money(claim.claimAmount), { mono: true }),
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
        cell("Accident time", claim.accidentTime, { mono: true }),
        cell("Location", place(claim.accidentLocation)),
        cell("Report delay", claim.delayDays != null ? `${claim.delayDays} days` : null),
        cell("Police report", yesNo(claim.policeReport)),
        cell("Witnesses", claim.witnessCount),
        cell("Repair shop", claim.repairShop, { editableKey: "repairShop" }),
        cell("Adjuster ID", claim.adjusterId, { mono: true }),
        cell("Payment method", humanizeEnum(claim.paymentMethod)),
        cell("Channel", humanizeEnum(claim.channel)),
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
        cell("Vehicle value", money(vehicle.value), { mono: true }),
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
      cell("Annual premium", money(premium.annualPremium), { mono: true }),
      cell("Outstanding balance", money(premium.outstandingBalance), { mono: true }),
    ],
    coverages: (policy.coverages || []).map((coverage) => ({
      id: coverage.coverageCode || coverage.coverageType,
      name: humanizeEnum(coverage.coverageType) || coverage.coverageCode,
      limit: money(coverage.limit) || "—",
      deductible: money(coverage.deductible) || "—",
      premium: money(coverage.annualPremium) || "—",
    })),
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

/** Audit timeline. Agent runs read as Lavender; lifecycle events as neutral. */
export function toAuditTimeline(response) {
  return (response?.records || []).map((record, index) => {
    const isAgentRun = record.computedScore != null || record.matchedPatterns != null;
    const matched = record.matchedPatterns?.length ?? null;

    return {
      id: `${record.claimId || "record"}-${index}`,
      isAgentRun,
      title: isAgentRun ? "Fraud analysis run" : humanizeEnum(record.eventType) || "Claim event",
      timestampLabel: toMonoTimestamp(record.createdAt),
      details: [
        isAgentRun
          ? `Triggered by ${record.triggeredBy || record.agentName || "agent"}`
          : record.detail || "Routine lifecycle event",
        isAgentRun && record.patternsEvaluatedCount != null
          ? `${record.patternsEvaluatedCount} patterns checked, ${matched ?? 0} matched`
          : null,
      ].filter(Boolean),
    };
  });
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
