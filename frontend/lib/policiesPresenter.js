import { humanizeEnum, toCustomerName, toMonoDateFull, toMoney } from "./claimsPresenter";
import { toCustomerClaimRows } from "./customersPresenter";

/**
 * Policy view models. Policy status is a category, so it is always presented
 * for the neutral Badge — never for the fraud StatusPill.
 */

/* Filterable values. These are plain strings in the backend schema rather than
   enums, so an unrecognised stored value is appended to its own list instead of
   being silently unfilterable. Observed live: every policy is ACTIVE, so the
   other statuses legitimately return zero rows today. */
export const POLICY_STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED", "LAPSED"];
export const COVERAGE_TYPES = [
  "LIABILITY_BODILY_INJURY",
  "LIABILITY_PROPERTY_DAMAGE",
  "COLLISION",
  "COMPREHENSIVE",
  "UNINSURED_MOTORIST",
  "MEDICAL_PAYMENTS",
];

export const POLICY_SORT_OPTIONS = [
  { id: "-effectivePeriod.endDate", label: "Renewal date (latest)" },
  { id: "effectivePeriod.endDate", label: "Renewal date (soonest)" },
  { id: "-annualPremium", label: "Highest premium" },
  { id: "policyId", label: "Policy ID" },
];

const ANY = "all";

/** The two filter chips this screen has and Customers doesn't. */
export function toPolicyFilterControls(filters) {
  const controls = [
    {
      id: "status",
      label: "Status",
      options: [
        { id: ANY, label: "Any status" },
        ...POLICY_STATUSES.map((value) => ({ id: value, label: humanizeEnum(value) })),
      ],
    },
    {
      id: "coverageType",
      label: "Coverage type",
      options: [
        { id: ANY, label: "Any coverage" },
        ...COVERAGE_TYPES.map((value) => ({ id: value, label: humanizeEnum(value) })),
      ],
    },
  ];

  return controls.map((control) => {
    const selectedId = filters[control.id] ?? ANY;
    const selected = control.options.find((option) => option.id === selectedId);
    return {
      ...control,
      selectedId,
      isActive: selectedId !== ANY,
      buttonLabel: selectedId === ANY ? control.label : `${control.label}: ${selected?.label}`,
    };
  });
}

export function toPolicySortControl(sortId) {
  const selected = POLICY_SORT_OPTIONS.find((o) => o.id === sortId) || POLICY_SORT_OPTIONS[0];
  return {
    id: "sort",
    selectedId: selected.id,
    options: POLICY_SORT_OPTIONS,
    buttonLabel: `Sort: ${selected.label.toLowerCase()}`,
  };
}

/** One list row. */
export function toPolicyListRow(policy) {
  const period = policy.effectivePeriod || {};
  const dates = [period.startDate, period.endDate].filter(Boolean).map(toMonoDateFull);
  return {
    id: policy.policyId,
    policyId: policy.policyId,
    customerName: policy.customerName || "Unknown customer",
    typeLabel: humanizeEnum(policy.policyType) || "—",
    statusLabel: humanizeEnum(policy.status) || "Unknown",
    periodLabel: dates.length ? dates.join(" – ") : "—",
    premiumLabel: toMoney(policy.premium?.annualPremium ?? policy.annualPremium) || "—",
  };
}

export function toPolicyList(response) {
  const rows = (response?.policies || []).map(toPolicyListRow);
  const total = response?.total ?? rows.length;
  return {
    rows,
    total,
    subtitle: `${total} ${total === 1 ? "policy" : "policies"} in your portfolio`,
  };
}

/** One coverage line, in the shape the shared CoveragesTable renders. */
export function toCoverageRows(coverages) {
  return (coverages || []).map((coverage) => ({
    id: coverage.coverageCode || coverage.coverageType,
    name: humanizeEnum(coverage.coverageType) || coverage.coverageCode,
    limitLabel: toMoney(coverage.limit) || "—",
    deductibleLabel: toMoney(coverage.deductible) || "—",
    premiumLabel: toMoney(coverage.annualPremium) || "—",
  }));
}

export function toPolicyDetail(policy) {
  const period = policy.effectivePeriod || {};
  const premium = policy.premium || {};
  const dates = [period.startDate, period.endDate].filter(Boolean).map(toMonoDateFull);
  const vehicle = policy.vehicle || {};

  return {
    policyId: policy.policyId,
    typeLabel: humanizeEnum(policy.policyType) || "—",
    statusLabel: humanizeEnum(policy.status) || "Unknown",
    customerId: policy.customerId,
    customerName: toCustomerName(policy.customer) || "Unknown customer",
    facts: [
      { id: "period", label: "Effective period", value: dates.join(" – ") || "—", isMono: true },
      { id: "premium", label: "Annual premium", value: toMoney(premium.annualPremium) || "—", isMono: true },
      { id: "balance", label: "Outstanding balance", value: toMoney(premium.outstandingBalance) || "—", isMono: true },
      { id: "channel", label: "Channel", value: humanizeEnum(policy.channel) || "—" },
      {
        id: "vehicle",
        label: "Vehicle",
        value: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—",
      },
    ],
    coverages: toCoverageRows(policy.coverages),
    // Claims on a policy are fraud-scored, so they reuse the claims presenter.
    claimRows: toCustomerClaimRows(policy.claims),
  };
}
