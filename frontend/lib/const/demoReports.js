/**
 * Demo fraud reports, keyed by claim id.
 *
 * `claim` mirrors ClaimDetailResponse; `review` mirrors one claim_fraud_reviews
 * document as returned by GET /claims/{id}/audit.
 *
 * NOTE — backend gap: the review documents below carry per-match `rationale`
 * text and a `similarClaims` evidence list, neither of which anything in the
 * current Phase 2/2b spec actually persists. See lib/claimsPresenter.js
 * (toFraudReportViewModel) and the README note; persist_fraud_assessment and
 * write_audit_record need to write this content at scoring time, because
 * rationale like "93% of insured value" depends on the claim's numbers at the
 * moment of analysis and cannot be reconstructed from a pattern's static
 * ruleLogic afterwards.
 */

const STEPS = [
  "Fetched claim, policy and customer context",
  "Evaluated 22 active fraud patterns against the claim",
  "Ran historical-similarity search over prior claims",
  "Computed raw score and applied the 12-point cap",
  "Persisted the assessment and wrote the audit record",
];

export const DEMO_REPORTS = {
  "CLM-2010": {
    claim: {
      claimId: "CLM-2010",
      customerName: "Marta Oyelaran",
      claimType: "Collision",
      coverageType: "Collision",
      claimStatus: "PENDING_REVIEW",
      fraud: {
        processed: true,
        computedScore: 11,
        fraudFlag: null,
        reviewedBy: null,
        reviewedAt: null,
        dismissReason: null,
      },
    },
    review: {
      claimId: "CLM-2010",
      createdAt: "2026-08-14T09:12:00Z",
      agentName: "agent",
      rawScore: 14,
      computedScore: 11,
      patternsEvaluatedCount: 22,
      steps: STEPS,
      matchedPatterns: [
        {
          patternId: "FP-014",
          patternName: "Claim amount near insured value",
          patternType: "RULE",
          weight: 3,
          rationale: "Claim amount is 93% of the insured value on this policy.",
        },
        {
          patternId: "FP-002",
          patternName: "Staged collision cluster",
          patternType: "SIMILARITY",
          weight: 3,
          rationale: "Three prior claims share this incident location and damage profile.",
        },
        {
          patternId: "FP-007",
          patternName: "Repeat repair shop",
          patternType: "RULE",
          weight: 2,
          rationale: "Repair shop appears on 11 claims in the last 90 days, 4 of them confirmed fraud.",
        },
        {
          patternId: "FP-019",
          patternName: "Late-night incident, no police report",
          patternType: "RULE",
          weight: 2,
          rationale: "Incident logged at 02:40 with no police report and no witnesses.",
        },
        {
          patternId: "FP-021",
          patternName: "Policy-inception proximity",
          patternType: "RULE",
          weight: 2,
          rationale: "Loss occurred 19 days after the policy was written.",
        },
        {
          patternId: "FP-005",
          patternName: "Narrative reuse",
          patternType: "SIMILARITY",
          weight: 1,
          rationale: "Claim description closely matches wording used on CLM-1844.",
        },
        {
          patternId: "FP-011",
          patternName: "Adjuster override",
          patternType: "RULE",
          weight: 1,
          rationale: "Initial assessment was manually raised before submission.",
        },
      ],
      similarClaims: [
        {
          claimId: "CLM-1844",
          similarity: 0.92,
          reason: "Same repair shop and near-identical damage narrative",
          fraudFlag: true,
          reviewedBy: "Alex Tran",
        },
        {
          claimId: "CLM-1791",
          similarity: 0.81,
          reason: "Shared incident location, overlapping witness identity",
          fraudFlag: true,
          reviewedBy: "Dana Okafor",
        },
        {
          claimId: "CLM-1655",
          similarity: 0.74,
          reason: "Comparable amount-to-insured-value ratio",
          fraudFlag: false,
          reviewedBy: "Alex Tran",
        },
      ],
    },
  },

  /* Already decided — the drawer shows the past decision, never the buttons. */
  "CLM-2011": {
    claim: {
      claimId: "CLM-2011",
      customerName: "Devon Ashworth",
      claimType: "Comprehensive",
      coverageType: "Comprehensive",
      claimStatus: "FLAGGED",
      fraud: {
        processed: true,
        computedScore: 12,
        fraudFlag: true,
        reviewedBy: "Alex Tran",
        reviewedAt: "2026-08-14T08:05:00Z",
        dismissReason: null,
      },
    },
    review: {
      claimId: "CLM-2011",
      createdAt: "2026-08-14T07:40:00Z",
      agentName: "agent",
      rawScore: 17,
      computedScore: 12,
      patternsEvaluatedCount: 22,
      steps: STEPS,
      matchedPatterns: [
        {
          patternId: "FP-003",
          patternName: "Total-loss velocity",
          patternType: "RULE",
          weight: 3,
          rationale: "Third total-loss claim on this customer in 14 months.",
        },
        {
          patternId: "FP-002",
          patternName: "Staged collision cluster",
          patternType: "SIMILARITY",
          weight: 3,
          rationale: "Incident matches a known cluster of six linked claims.",
        },
        {
          patternId: "FP-016",
          patternName: "Shared witness identity",
          patternType: "RULE",
          weight: 3,
          rationale: "Listed witness also appears on CLM-1844 and CLM-1791.",
        },
        {
          patternId: "FP-007",
          patternName: "Repeat repair shop",
          patternType: "RULE",
          weight: 2,
          rationale: "Repair shop is under active review for prior confirmed fraud.",
        },
        {
          patternId: "FP-011",
          patternName: "Payment method change",
          patternType: "RULE",
          weight: 1,
          rationale: "Payout account changed two days before submission.",
        },
      ],
      similarClaims: [
        {
          claimId: "CLM-1844",
          similarity: 0.95,
          reason: "Same witness and repair shop, matching damage narrative",
          fraudFlag: true,
          reviewedBy: "Alex Tran",
        },
        {
          claimId: "CLM-2016",
          similarity: 0.78,
          reason: "Overlapping pattern set, same claim cluster",
          fraudFlag: true,
          reviewedBy: "Dana Okafor",
        },
      ],
    },
  },

  /* No similarity evidence — that section is omitted entirely, not shown empty.
     rawScore === computedScore, so no capping clause is stated either. */
  "CLM-2018": {
    claim: {
      claimId: "CLM-2018",
      customerName: "Nikolai Petrov",
      claimType: "Uninsured motorist",
      coverageType: "Uninsured motorist",
      claimStatus: "PENDING_REVIEW",
      fraud: {
        processed: true,
        computedScore: 8,
        fraudFlag: null,
        reviewedBy: null,
        reviewedAt: null,
        dismissReason: null,
      },
    },
    review: {
      claimId: "CLM-2018",
      createdAt: "2026-08-13T21:15:00Z",
      agentName: "agent",
      rawScore: 8,
      computedScore: 8,
      patternsEvaluatedCount: 22,
      steps: STEPS,
      matchedPatterns: [
        {
          patternId: "FP-019",
          patternName: "Missing police report",
          patternType: "RULE",
          weight: 3,
          rationale: "Uninsured-motorist claim filed with no police report on file.",
        },
        {
          patternId: "FP-014",
          patternName: "Claim amount near insured value",
          patternType: "RULE",
          weight: 3,
          rationale: "Claim amount is 88% of the insured value on this policy.",
        },
        {
          patternId: "FP-022",
          patternName: "Delayed reporting",
          patternType: "RULE",
          weight: 2,
          rationale: "Loss reported 21 days after the stated incident date.",
        },
      ],
      similarClaims: [],
    },
  },
};

/** Fallback for any claim without a hand-authored demo report. */
export function toDemoReport(claimId, row) {
  if (DEMO_REPORTS[claimId]) return DEMO_REPORTS[claimId];
  return {
    claim: {
      claimId,
      customerName: row?.customerName,
      claimType: row?.coverage,
      claimStatus: "PENDING_REVIEW",
      fraud: { processed: true, computedScore: row?.scoreValue ?? null, fraudFlag: null },
    },
    review: {
      claimId,
      createdAt: "2026-08-13T12:00:00Z",
      rawScore: row?.scoreValue ?? null,
      computedScore: row?.scoreValue ?? null,
      patternsEvaluatedCount: 22,
      steps: STEPS,
      matchedPatterns: [],
      similarClaims: [],
    },
  };
}
