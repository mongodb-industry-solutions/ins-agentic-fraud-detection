/**
 * Fraud-pattern documents -> view models. Same contract as claimsPresenter:
 * the components never see raw API JSON.
 */

import { STATUS, STATUS_LABEL, humanizeEnum, toMonoDate, toScoreLabel } from "./claimsPresenter";

export const PATTERN_TYPE = {
  RULE: "RULE",
  SIMILARITY: "HISTORICAL_SIMILARITY",
};

export const PATTERN_TYPE_LABEL = {
  [PATTERN_TYPE.RULE]: "Rule",
  [PATTERN_TYPE.SIMILARITY]: "Similarity",
};

/** Enum vocabularies the stored patterns actually use, for the add-forms. */
export const CLAIM_TYPE_OPTIONS = ["AUTO_COLLISION", "AUTO_THEFT", "AUTO_GLASS"];
export const COVERAGE_TYPE_OPTIONS = ["COLLISION", "COMPREHENSIVE", "LIABILITY_BODILY_INJURY"];
export const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH"];

/** Rule-logic vocabulary, taken from the operators present in the catalogue. */
export const CONDITION_FIELD_OPTIONS = [
  "claimDate",
  "claimType",
  "coverageType",
  "claimAmount",
  "policeReport",
  "reportDelayDays",
  "policyAgeDays",
];

export const CONDITION_OPERATOR_OPTIONS = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "LESS_THAN",
  "IN",
  "DAYS_BETWEEN_LESS_THAN",
];

export function toWeightLabel(weight) {
  if (weight === null || weight === undefined) return "—";
  return `+${weight}`;
}

export function toRateLabel(rate) {
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 100)}%`;
}

/**
 * The embedding is what similarity search consumes, so a similarity pattern
 * without one is inert — which is the state every newly created pattern starts
 * in, until the embedding procedure runs.
 *
 * `hasEmbedding` is computed server-side and present on every pattern the API
 * returns; the vector itself never is. Inferring this from `embeddingText`
 * instead would call a brand-new pattern ready, since the text is exactly what
 * it does have and the embedding is exactly what it doesn't.
 */
function isEmbeddingPending(pattern) {
  if (pattern.patternType !== PATTERN_TYPE.SIMILARITY) return false;
  return !pattern.hasEmbedding;
}

export function toPatternCardViewModel(pattern) {
  const stats = pattern.stats || {};
  return {
    id: pattern.patternId,
    // The collection stores `name`, not `patternName`.
    name: pattern.name || pattern.patternId,
    weight: pattern.weight ?? null,
    weightLabel: toWeightLabel(pattern.weight),
    active: pattern.active !== false,
    patternType: pattern.patternType,
    typeLabel: PATTERN_TYPE_LABEL[pattern.patternType] || humanizeEnum(pattern.patternType),
    timesTriggered: stats.timesTriggered ?? 0,
    confirmedCount: stats.confirmedCount ?? 0,
    confirmedFraudRate: toRateLabel(stats.confirmedFraudRate),
    // Raw values for client-side sorting; the *Label fields are what renders.
    rateValue: stats.confirmedFraudRate ?? 0,
    weightValue: pattern.weight ?? 0,
    embeddingPending: isEmbeddingPending(pattern),
  };
}

/**
 * `ruleLogic` is a single comparison object, not a `conditions` array, and it
 * carries optional extras (comparisonField, a secondary bound, a lookback
 * window). Each of those is a real part of the rule, so each becomes its own
 * row rather than being dropped to fit a three-token shape.
 */
export function toConditionRows(ruleLogic) {
  if (!ruleLogic) return [];
  if (Array.isArray(ruleLogic.conditions)) {
    return ruleLogic.conditions.map((condition) => ({
      field: condition.field,
      operator: humanizeEnum(condition.operator)?.toLowerCase() || condition.operator,
      value: String(condition.value),
    }));
  }

  const rows = [];
  const operatorLabel = (operator) => humanizeEnum(operator)?.toLowerCase() || operator;

  rows.push({
    field: ruleLogic.comparisonField
      ? `${ruleLogic.field} → ${ruleLogic.comparisonField}`
      : ruleLogic.field,
    operator: operatorLabel(ruleLogic.operator),
    value: String(ruleLogic.value),
  });

  if (ruleLogic.secondaryOperator !== undefined) {
    rows.push({
      field: ruleLogic.field,
      operator: operatorLabel(ruleLogic.secondaryOperator),
      value: String(ruleLogic.value2),
    });
  }

  if (ruleLogic.windowDays !== undefined) {
    rows.push({ field: "window", operator: "days", value: String(ruleLogic.windowDays) });
  }

  return rows;
}

/**
 * A matched claim as returned by the detail endpoint: a flat projection with
 * claimId / claimDate / customerName / computedScore / fraudFlag and no
 * `processed` flag, so "not yet analyzed" is not distinguishable here. A claim
 * that matched a pattern has by definition been scored, so a null fraudFlag is
 * read as awaiting a decision.
 */
function toMatchedClaimRow(claim) {
  let statusKey = STATUS.PENDING;
  if (claim.fraudFlag === true) statusKey = STATUS.FLAGGED;
  else if (claim.fraudFlag === false) statusKey = STATUS.CLEARED;

  return {
    id: claim.claimId,
    claimId: claim.claimId,
    customerName: claim.customerName || "Unknown customer",
    openedLabel: toMonoDate(claim.claimDate),
    scoreLabel: toScoreLabel(claim.computedScore),
    statusKey,
    statusLabel: STATUS_LABEL[statusKey],
  };
}

export function toPatternDetailViewModel(pattern, matchedClaims = []) {
  const isRule = pattern.patternType === PATTERN_TYPE.RULE;
  const appliesTo = pattern.appliesTo || {};

  return {
    ...toPatternCardViewModel(pattern),
    severity: pattern.severity || "—",
    conditions: isRule ? toConditionRows(pattern.ruleLogic) : [],
    // The stored prose as-is, for the edit form. `internalDescription` below is
    // the same value gated on pattern type, which is what the read view shows.
    description: pattern.description || "",
    internalDescription: isRule ? pattern.description : null,
    embeddingText: isRule ? null : pattern.embeddingText || pattern.description,
    appliesTo: {
      claimTypes: (appliesTo.claimTypes || []).map(humanizeEnum),
      coverageTypes: (appliesTo.coverageTypes || []).map(humanizeEnum),
    },
    matchedClaims: matchedClaims.map(toMatchedClaimRow),
    /* Explicitly absent: this needs a portfolio-wide confirmed-fraud count,
       which get_fraud_pattern_detail does not return. Rendered as an em-dash
       with a note rather than computed from the numbers that are here — those
       would give a different, wrong figure. */
    shareOfAllFraudClaims: null,
  };
}

/** The sort control offered on each column header. */
export const PATTERN_SORTS = [
  { id: "triggered", label: "Most triggered" },
  { id: "rate", label: "Highest confirmed rate" },
  { id: "weight", label: "Highest weight" },
  { id: "name", label: "Name (A–Z)" },
];

export function sortPatterns(patterns, sortId) {
  const sorted = [...patterns];
  switch (sortId) {
    case "rate":
      return sorted.sort((a, b) => b.rateValue - a.rateValue);
    case "weight":
      return sorted.sort((a, b) => b.weightValue - a.weightValue);
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return sorted.sort((a, b) => b.timesTriggered - a.timesTriggered);
  }
}

export function toPatternSortControl(sortId) {
  const selected = PATTERN_SORTS.find((option) => option.id === sortId) || PATTERN_SORTS[0];
  return {
    id: "patternSort",
    buttonLabel: selected.label,
    selectedId: selected.id,
    isActive: selected.id !== PATTERN_SORTS[0].id,
    options: PATTERN_SORTS,
  };
}
