import {
  STATUS,
  STATUS_LABEL,
  humanizeEnum,
  toCustomerName,
  toMonoDate,
  toMonoDateFull,
  toMoney,
  toScoreLabel,
} from "./claimsPresenter";

/**
 * Customer directory view models.
 *
 * Customers are not fraud-scored entities, so nothing here produces fraud
 * state — except the claims history table, whose rows genuinely are scored and
 * therefore reuse the same status/score presenters as the dashboard.
 */

const place = (address) =>
  address ? [address.city, address.state].filter(Boolean).join(", ") || null : null;

const year = (value) => (value ? String(value).slice(0, 4) : null);

export const CUSTOMER_SORT_OPTIONS = [
  { id: "-customerSince", label: "Newest customers" },
  { id: "customerSince", label: "Longest tenure" },
  { id: "-policyCount", label: "Most policies" },
  { id: "-claimCount", label: "Most claims" },
  { id: "name", label: "Name (A–Z)" },
];

export function toCustomerSortControl(sortId) {
  const selected = CUSTOMER_SORT_OPTIONS.find((o) => o.id === sortId) || CUSTOMER_SORT_OPTIONS[0];
  return {
    id: "sort",
    selectedId: selected.id,
    options: CUSTOMER_SORT_OPTIONS,
    buttonLabel: `Sort: ${selected.label.toLowerCase()}`,
  };
}

/**
 * One directory row.
 *
 * `location` is intentionally read from a field the list endpoint does not
 * currently return (CustomerListItem carries no address), so it resolves to
 * null and the table drops the column rather than rendering a column of
 * em-dashes. Adding `location` to CustomerListItem and its projection is all
 * that is needed for the column to appear.
 */
export function toCustomerRow(customer) {
  return {
    id: customer.customerId,
    customerId: customer.customerId,
    name: customer.name || toCustomerName(customer) || "Unknown customer",
    sinceLabel: year(customer.customerSince) || "—",
    location: place(customer.address) || customer.location || null,
    policyCount: customer.policyCount ?? 0,
    claimCount: customer.claimCount ?? 0,
  };
}

export function toCustomerList(response) {
  const rows = (response?.customers || []).map(toCustomerRow);
  const total = response?.total ?? rows.length;
  return {
    rows,
    total,
    subtitle: `${total} ${total === 1 ? "customer" : "customers"} in your portfolio`,
    // Only render the Location column once the data actually carries one.
    hasLocation: rows.some((row) => row.location),
  };
}

export function toCustomerHeader(customer) {
  const since = year(customer?.customerSince);
  return {
    customerId: customer.customerId,
    name: customer.name || toCustomerName(customer) || "Unknown customer",
    tenureLabel: since ? `Customer since ${since}` : "Tenure unknown",
    facts: [
      { id: "location", label: "Location", value: place(customer.address) || "—" },
      // Counted from the joined records, not the customer document's stored
      // numPolicies/numPreviousClaims counters: those are denormalised and
      // drift (CUST-1001 stores numPolicies 2 while only POL-1001 exists).
      // A header that contradicts the table right below it reads as a bug, so
      // the tables are the source of truth here.
      { id: "policies", label: "Policies held", value: String((customer.policies || []).length), isMono: true },
      { id: "claims", label: "Claims filed", value: String((customer.claims || []).length), isMono: true },
      { id: "license", label: "License years", value: customer.licenseYears != null ? String(customer.licenseYears) : "—", isMono: true },
    ],
  };
}

/**
 * Policies held. `statusLabel` feeds the neutral Badge component — never the
 * fraud StatusPill: policy status (Active/Expired/Cancelled) and fraud status
 * are unrelated semantic systems, and letting policy status borrow the
 * Lavender/Mist/Evergreen grammar would break what those colors mean.
 */
export function toPolicyRows(policies) {
  return (policies || []).map((policy) => {
    const period = policy.effectivePeriod || {};
    const dates = [period.startDate, period.endDate].filter(Boolean).map(toMonoDateFull);
    return {
      id: policy.policyId,
      policyId: policy.policyId,
      typeLabel: humanizeEnum(policy.policyType) || "—",
      statusLabel: humanizeEnum(policy.status) || "Unknown",
      periodLabel: dates.length ? dates.join(" – ") : "—",
      premiumLabel: toMoney(policy.premium?.annualPremium ?? policy.annualPremium) || "—",
    };
  });
}

/** Claims history. These rows are fraud-scored, so they use the real pills. */
export function toCustomerClaimRows(claims) {
  return (claims || []).map((claim) => {
    const statusKey =
      claim.fraudFlag === true
        ? STATUS.FLAGGED
        : !claim.processed
          ? STATUS.UNPROCESSED
          : claim.fraudFlag === false
            ? STATUS.CLEARED
            : STATUS.PENDING;

    return {
      id: claim.claimId,
      claimId: claim.claimId,
      typeLabel: humanizeEnum(claim.claimType) || "—",
      openedLabel: toMonoDate(claim.claimDate),
      statusKey,
      statusLabel: STATUS_LABEL[statusKey],
      scoreLabel: claim.processed ? toScoreLabel(claim.computedScore) : null,
    };
  });
}
