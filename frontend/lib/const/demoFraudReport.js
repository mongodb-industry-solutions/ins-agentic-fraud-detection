/**
 * A complete `FraudReportData` fixture, used to develop and review
 * `FraudReportContent` before the agent-side payload exists.
 *
 * The values are taken from a real assessment run of CLM-2010 (score 7/12,
 * REVIEW band, patterns FP-005/FP-002/FP-003/FP-006), so the layout is
 * exercised against realistic content lengths rather than lorem ipsum.
 *
 * Delete this once `run_complete` returns the real shape — it exists to unblock
 * the UI, not to ship as a fallback. Every field below is one the backend must
 * produce; `narrative`, `supportingEvidence`, `precedent` and `verdict` in
 * particular cannot be reconstructed from the sparse `matchedPatterns` currently
 * stored on a claim.
 */
export const DEMO_FRAUD_REPORT = {
  claimId: "CLM-2010",
  traceId: "TRC-C2A87051A7F8",

  claimSummary: {
    customerName: "Laura Kim",
    customerId: "CUST-1010",
    policyId: "POL-1010",
    policyStatus: "ACTIVE",
    policyStart: "2024-06-01",
    policyEnd: "2025-06-01",
    claimType: "AUTO_COLLISION",
    coverageType: "COLLISION",
    claimAmount: 3000,
    paidAmount: 0,
    claimStatus: "OPEN",
    complexity: "SIMPLE",
    vehicle: {
      year: 2022,
      make: "Mazda",
      model: "Mazda3",
      vin: "JM1BPBLM3N1234567",
      value: 16500,
    },
    repairShop: "Beantown Auto Repair",
    adjusterId: "ADJ-004",
    lossDate: "2025-02-01T10:00:00Z",
    reportDate: "2025-02-13T09:15:00Z",
    reportDelayDays: 12,
    policeReportFiled: false,
    witnessCount: 0,
  },

  score: {
    computedScore: 7,
    rawScore: 7,
    maxScore: 12,
    bandLabel: "REVIEW",
    bandDescriptor: "elevated",
    capped: false,
  },

  triggeredRules: [
    {
      patternId: "FP-005",
      patternName: "No police report on a collision claim",
      patternType: "RULE",
      weight: 2,
      severity: "HIGH",
      confirmedCount: 14,
      timesTriggered: 19,
      confirmedFraudRate: 0.74,
      narrative:
        "No police report was filed for a collision claim of $3,000. Collisions at this value are almost always documented, and the absence of a report removes the only independent account of how the loss occurred.",
    },
    {
      patternId: "FP-002",
      patternName: "Claim shortly after policy inception",
      patternType: "RULE",
      weight: 2,
      severity: "MEDIUM",
      confirmedCount: 9,
      timesTriggered: 22,
      confirmedFraudRate: 0.41,
      narrative:
        "The loss occurred eight months into a twelve-month policy term, with no prior claim history on the account. This is inside the window where opportunistic first claims cluster, though not the highest-risk part of it.",
    },
    {
      patternId: "FP-003",
      patternName: "Suspiciously round claim amount",
      patternType: "RULE",
      weight: 1,
      severity: "LOW",
      confirmedCount: 6,
      timesTriggered: 31,
      confirmedFraudRate: 0.19,
      narrative:
        "The claimed amount is exactly $3,000. Genuine repair estimates rarely land on a round thousand, though a round figure alone is weak evidence and this pattern's own confirmation rate reflects that.",
    },
    {
      patternId: "FP-006",
      patternName: "Significant delay between loss and report",
      patternType: "RULE",
      weight: 2,
      severity: "MEDIUM",
      confirmedCount: 11,
      timesTriggered: 25,
      confirmedFraudRate: 0.44,
      narrative:
        "The loss was reported 12 days after it occurred. Delays of this length reduce the chance of physical verification and are common where damage is pre-existing or staged.",
    },
  ],

  precedent: {
    status: "DEGRADED_WITH_MATCH",
    degradedReason: "embedding service offline",
    comparison: {
      priorClaimId: "CLM-1042",
      fields: [
        { label: "Customer", priorValue: "Laura Kim (CUST-1010)", currentValue: "Laura Kim (CUST-1010)" },
        { label: "Repair shop", priorValue: "Beantown Auto Repair", currentValue: "Beantown Auto Repair" },
        { label: "Claim amount", priorValue: "$2,800", currentValue: "$3,000" },
        { label: "Police report", priorValue: "No", currentValue: "No" },
        { label: "Report delay", priorValue: "14 days", currentValue: "12 days" },
        { label: "Outcome", priorValue: "Closed · Denied · SIU-referred", currentValue: "Open · pending review" },
      ],
    },
  },

  supportingEvidence: [
    {
      signal: "No independent account of the loss",
      detail:
        "No police report and zero witnesses. Nothing corroborates the claimant's description of the collision.",
      severity: "CRITICAL",
    },
    {
      signal: "Repair shop appears in a prior denied claim",
      detail:
        "Beantown Auto Repair also handled CLM-1042, which was denied and referred to SIU.",
      severity: "CRITICAL",
    },
    {
      signal: "Claim amount is 18% of vehicle value",
      detail:
        "$3,000 against a $16,500 vehicle. High for a single collision, but not implausible on its own.",
      severity: "WARNING",
    },
    {
      signal: "Policy has been continuously active",
      detail:
        "No lapse, no reinstatement and no mid-term coverage increase before the loss.",
      severity: "INFO",
    },
    {
      signal: "No prior claims on the account",
      detail: "This is the customer's first claim, which counts against a pattern of abuse.",
      severity: "INFO",
    },
  ],

  verdict: {
    label: "FRAUD",
    confidence: "Medium",
    reason:
      "Four patterns matched for a combined score of 7, and the claim shares a customer, repair shop and documentation profile with CLM-1042 — a claim already denied and referred to SIU. The repeated absence of a police report across both claims is the strongest signal.",
    recommendation:
      "Confirm as fraud and refer to SIU. Request the repair estimate and any photographs before payment.",
    recommendsSIU: true,
  },

  decision: {
    state: "pending",
  },
};
