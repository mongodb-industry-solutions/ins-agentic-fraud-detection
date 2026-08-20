import { DEMO_CLAIM_LIST } from "./demoClaims";

/**
 * Offline fallback for the claim view, in the live ClaimDetailResponse shape
 * (SCREAMING_SNAKE enums, accidentLocation, *Snapshot blocks, policy.premium)
 * so the presenter takes the same path with or without a backend.
 */

const COVERAGES = [
  { coverageCode: "COLL", coverageType: "COLLISION", limit: 50000, deductible: 500, annualPremium: 620 },
  { coverageCode: "COMP", coverageType: "COMPREHENSIVE", limit: 50000, deductible: 500, annualPremium: 480 },
  {
    coverageCode: "LIAB_BI",
    coverageType: "LIABILITY_BODILY_INJURY",
    limit: 300000,
    deductible: 0,
    annualPremium: 510,
  },
];

const DETAILS = {
  "CLM-2010": {
    policyId: "POL-40881",
    customerId: "CUST-9142",
    accidentTime: "02:40",
    accidentLocation: { city: "Portland", state: "OR", region: "NORTHWEST" },
    delayDays: 3,
    policeReport: false,
    witnessCount: 0,
    repairShop: "Cascade Auto Body",
    adjusterId: "ADJ-0221",
    paymentMethod: "ACH",
    channel: "MOBILE_APP",
    driverSnapshot: { age: 34, licenseYears: 12 },
    vehicleSnapshot: { brand: "Subaru", model: "Outback", age: 5, value: 9100 },
    customerSnapshot: { numPreviousClaims: 2, numPolicies: 1 },
    policy: {
      policyId: "POL-40881",
      policyType: "PERSONAL_AUTO",
      status: "ACTIVE",
      effectivePeriod: { startDate: "2026-07-23", endDate: "2027-07-23", termMonths: 12 },
      premium: { annualPremium: 1800, outstandingBalance: 450 },
      coverages: COVERAGES,
    },
    customer: {
      firstName: "Marta",
      lastName: "Oyelaran",
      customerSince: "2019-04-02",
      address: { city: "Portland", state: "OR" },
      numPolicies: 2,
      // Deliberately one higher than the claim-time snapshot above: another
      // claim has been filed since this one.
      numPreviousClaims: 3,
      licenseYears: 13,
    },
    linked: {
      total: 2,
      linked: [
        {
          claimId: "CLM-1844",
          customerName: "Devon Ashworth",
          linkReasons: ["Shared fraud pattern(s): Staged collision cluster", "Same repair shop"],
        },
        { claimId: "CLM-1791", customerName: "Marta Oyelaran", linkReasons: ["Same customer"] },
      ],
    },
    audit: {
      total: 2,
      records: [
        {
          claimId: "CLM-2010",
          createdAt: "2026-08-14T09:12:00Z",
          computedScore: 11,
          matchedPatterns: new Array(7),
          patternsEvaluatedCount: 22,
          triggeredBy: "batch run BR-118",
        },
        {
          claimId: "CLM-2010",
          createdAt: "2026-08-11T05:02:00Z",
          eventType: "CLAIM_OPENED",
          detail: "Filed via mobile app by the policyholder",
        },
      ],
    },
  },

  /* Unprocessed: no score fact in the header, no linked claims, empty audit. */
  "CLM-2012": {
    policyId: "POL-41207",
    customerId: "CUST-8830",
    accidentTime: "14:20",
    accidentLocation: { city: "Beaverton", state: "OR", region: "NORTHWEST" },
    delayDays: 0,
    policeReport: true,
    witnessCount: 2,
    repairShop: "Beaverton Collision Center",
    adjusterId: "ADJ-0104",
    paymentMethod: "CHECK",
    channel: "PHONE",
    driverSnapshot: { age: 41, licenseYears: 22 },
    vehicleSnapshot: { brand: "Toyota", model: "Camry", age: 7, value: 14200 },
    customerSnapshot: { numPreviousClaims: 0, numPolicies: 2 },
    policy: {
      policyId: "POL-41207",
      policyType: "PERSONAL_AUTO",
      status: "ACTIVE",
      effectivePeriod: { startDate: "2025-03-01", endDate: "2027-03-01", termMonths: 24 },
      premium: { annualPremium: 1420, outstandingBalance: 0 },
      coverages: COVERAGES.slice(0, 2),
    },
    customer: {
      firstName: "Priya",
      lastName: "Ramanathan",
      customerSince: "2021-06-15",
      address: { city: "Beaverton", state: "OR" },
      numPolicies: 2,
      numPreviousClaims: 0,
      licenseYears: 22,
    },
    linked: { total: 0, linked: [] },
    audit: { total: 0, records: [] },
  },
};

/** Merges the list row with the richer detail block, or borrows one. */
export function toDemoClaimDetail(claimId) {
  const row = DEMO_CLAIM_LIST.claims.find((claim) => claim.claimId === claimId);
  const detail = DETAILS[claimId] || DETAILS["CLM-2010"];

  const claim = {
    claimId,
    claimDate: row?.claimDate,
    claimType: row?.coverageType ? `AUTO_${row.coverageType.toUpperCase()}` : null,
    coverageType: row?.coverageType?.toUpperCase(),
    claimAmount: row?.claimAmount,
    claimStatus: "OPEN",
    complexity: row?.complexity,
    customerName: row?.customerName,
    fraud: {
      processed: row?.processed ?? false,
      computedScore: row?.computedScore ?? null,
      rawScore: row?.computedScore ?? null,
      fraudFlag: row?.fraudFlag ?? null,
      reviewedBy: row?.fraudFlag === true ? "Alex Tran" : null,
      reviewedAt: row?.fraudFlag === true ? "2026-08-14T08:05:00Z" : null,
    },
    ...detail,
  };

  return { claim, linked: detail.linked, audit: detail.audit };
}
