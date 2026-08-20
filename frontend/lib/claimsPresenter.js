/**
 * Backend docs -> view models. Components never touch raw API JSON; they read
 * only the flat, already-formatted objects this file returns.
 */

/** The four states, and the only status keys any component is allowed to see. */
export const STATUS = {
  UNPROCESSED: "unprocessed",
  PENDING: "pending",
  FLAGGED: "flagged",
  CLEARED: "cleared",
};

export const STATUS_LABEL = {
  [STATUS.UNPROCESSED]: "Not yet analyzed",
  [STATUS.PENDING]: "Pending review",
  [STATUS.FLAGGED]: "Confirmed fraud",
  [STATUS.CLEARED]: "Cleared — no fraud",
};

function toStatusKey(claim) {
  if (claim.fraudFlag === true) return STATUS.FLAGGED;
  if (claim.processed === false || claim.claimStatus === "UNPROCESSED") return STATUS.UNPROCESSED;
  if (claim.claimStatus === "CLEARED") return STATUS.CLEARED;
  if (claim.claimStatus === "FLAGGED") return STATUS.FLAGGED;
  return STATUS.PENDING;
}

/**
 * Backend enums are SCREAMING_SNAKE ("AUTO_COLLISION", "MOBILE_APP"). Short
 * all-caps tokens (ACH, SIU, MA) are genuine acronyms and stay as they are.
 */
export function humanizeEnum(value) {
  if (!value || typeof value !== "string") return value ?? null;
  if (!value.includes("_") && value === value.toUpperCase() && value.length <= 4) return value;
  const words = value.split("_").map((word) => {
    if (word === word.toUpperCase() && word.length <= 4) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), ...rest.map((w) => w.toLowerCase())]
    .join(" ")
    .replace(/\b(ach|siu|bi|pd)\b/gi, (match) => match.toUpperCase());
}

/** Customer documents carry first/last names, not a single display name. */
export function toCustomerName(customer) {
  if (!customer) return null;
  if (customer.customerName) return customer.customerName;
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null;
}

/** Source Code Pro is always all-caps outside real code: "AUG 14", never "Aug 14". */
export function toMonoDate(value) {
  if (!value) return "—";
  return new Date(value)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/** Year-bearing variant: "FEB 1, 2025". Used wherever two dates sit side by
 *  side or the year actually disambiguates something. */
export function toMonoDateFull(value) {
  if (!value) return null;
  return new Date(value)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

/** The agent's raw score is capped at this many points. */
export const MAX_SCORE = 12;

/** computedScore is capped points, not a ratio — shown bare in a Lavender chip. */
export function toScoreLabel(score) {
  if (score === null || score === undefined) return null;
  return String(Math.round(score));
}

/* The demo data is dated, so "now" is pinned rather than read from the clock —
   otherwise relative timestamps and date-range filters drift as time passes.
   Swap this for Date.now() when the dashboard is on live data. */
export const REFERENCE_NOW = Date.parse("2026-08-14T10:00:00Z");

export function toRelativeTime(value) {
  if (!value) return "";
  const minutes = Math.round((REFERENCE_NOW - Date.parse(value)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One claims-table row. */
export function toClaimRow(claim) {
  const statusKey = toStatusKey(claim);
  return {
    id: claim.claimId,
    claimId: claim.claimId,
    customerName: claim.customerName || "Unknown customer",
    customerSubline: claim.customerSince
      ? `Policyholder since ${claim.customerSince}`
      : "Policyholder",
    coverage: humanizeEnum(claim.coverageType || claim.claimType) || "—",
    openedLabel: toMonoDate(claim.claimDate),
    statusKey,
    statusLabel: STATUS_LABEL[statusKey],
    scoreLabel: toScoreLabel(claim.computedScore),
    // Sortable/filterable raw values. Components read these but never format
    // them — the *Label fields above are what gets rendered.
    openedAt: claim.claimDate ? Date.parse(claim.claimDate) : null,
    scoreValue: claim.computedScore ?? null,
    // Drives which segment filter the row survives; "all" always matches.
    segment: (claim.complexity || "SIMPLE").toLowerCase() === "complex" ? "complex" : "simple",
    isUnprocessed: statusKey === STATUS.UNPROCESSED,
  };
}

export function toClaimRows(response) {
  return (response?.claims || []).map(toClaimRow);
}

/** The four stat-strip columns, in fixed order. */
export function toStatStrip(response, trends = {}) {
  const stats = response?.stats || {};
  return [
    {
      id: "unprocessed",
      label: "Not yet analyzed",
      value: stats.unprocessed ?? 0,
      statusKey: STATUS.UNPROCESSED,
      icon: "clock",
      sparkline: { points: trends.unprocessed || [], tone: "sky" },
    },
    {
      id: "pending",
      label: "Pending your review",
      value: stats.pendingReview ?? 0,
      statusKey: STATUS.PENDING,
      icon: "inbox",
      delta: "+3",
    },
    {
      id: "flagged",
      label: "Flagged as fraud",
      value: stats.flagged ?? 0,
      statusKey: STATUS.FLAGGED,
      icon: "alert",
      sparkline: { points: trends.flagged || [], tone: "chartreuse" },
    },
    {
      id: "cleared",
      label: "Cleared this week",
      value: stats.cleared ?? 0,
      statusKey: STATUS.CLEARED,
      icon: "check",
      delta: "+5",
    },
  ];
}

/** Donut segments + legend rows. Colors match the status pills exactly. */
export function toStatusBreakdown(response) {
  const stats = response?.stats || {};
  const segments = [
    { statusKey: STATUS.UNPROCESSED, label: STATUS_LABEL[STATUS.UNPROCESSED], count: stats.unprocessed ?? 0 },
    { statusKey: STATUS.PENDING, label: STATUS_LABEL[STATUS.PENDING], count: stats.pendingReview ?? 0 },
    { statusKey: STATUS.FLAGGED, label: STATUS_LABEL[STATUS.FLAGGED], count: stats.flagged ?? 0 },
    { statusKey: STATUS.CLEARED, label: STATUS_LABEL[STATUS.CLEARED], count: stats.cleared ?? 0 },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  return { total, segments };
}

/** Header copy for the page title block. */
export function toPortfolioSummary(response) {
  const stats = response?.stats || {};
  const total = stats.total ?? 0;
  return `${total} claims in portfolio — ${stats.pendingReview ?? 0} awaiting your decision`;
}

/** One pending-queue row. */
export function toPendingRow(item) {
  const patterns = item.matchedPatterns || [];
  return {
    id: item.claimId,
    claimId: item.claimId,
    customerName: item.customerName || "Unknown customer",
    scoreLabel: toScoreLabel(item.computedScore),
    detail: [
      item.coverageType,
      `scored ${toRelativeTime(item.scoredAt)}`,
      `${patterns.length} pattern ${patterns.length === 1 ? "match" : "matches"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    tags: patterns.slice(0, 2),
    overflowTag: patterns.length > 2 ? `+${patterns.length - 2} more` : null,
  };
}

export function toPendingQueue(response) {
  const items = (response?.items || []).map(toPendingRow);
  const total = response?.total ?? items.length;
  return {
    total,
    items,
    caption: `${total} claims — agent scored, awaiting confirm/dismiss`,
  };
}

/** "AUG 9, 2:14 PM" — mono, so uppercase per the brand rule. */
export function toMonoTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  const day = date
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
  const time = date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
  return `${day}, ${time}`;
}

/**
 * The fraud report drawer's whole view model, merged from two sources:
 *
 *   claim  — GET /claims/{id}, authoritative for the *current* decision state
 *   review — newest entry of GET /claims/{id}/audit, authoritative for the
 *            analysis content (rationale, steps, similarity evidence)
 *
 * The sparse `fraud.matchedPatterns` array on the claim itself carries only
 * patternId/patternName/weight, which cannot render rationale text or
 * similarity evidence — that richer content has to come off the review doc.
 */
export function toFraudReportViewModel(claim, review) {
  if (!claim) return null;

  const fraud = claim.fraud || {};
  const rawScore = review?.rawScore ?? fraud.rawScore ?? null;
  const computedScore = fraud.computedScore ?? review?.computedScore ?? null;

  // Prefer the review's enriched matches; fall back to the claim's sparse array
  // so a claim scored before the enrichment lands still renders a pattern list,
  // just without rationale text.
  const rawPatterns = review?.matchedPatterns?.length
    ? review.matchedPatterns
    : fraud.matchedPatterns || [];

  const matchedPatterns = rawPatterns.map((pattern) => ({
    id: pattern.patternId,
    name: pattern.patternName || pattern.patternId,
    points: `+${pattern.weight ?? 0}`,
    typeLabel: (pattern.patternType || "RULE").toLowerCase() === "similarity" ? "Similarity" : "Rule",
    rationale: pattern.rationale || null,
  }));

  const similarClaims = (review?.similarClaims || []).map((similar) => ({
    claimId: similar.claimId,
    similarityLabel: `${Math.round((similar.similarity ?? 0) * 100)}%`,
    reason: similar.reason || "Similar claim narrative",
    statusKey: similar.fraudFlag
      ? STATUS.FLAGGED
      : similar.reviewedBy
        ? STATUS.CLEARED
        : STATUS.PENDING,
  }));

  return {
    claimId: claim.claimId,
    customerName: toCustomerName(claim.customer) || claim.customerName || "Unknown customer",
    claimType: humanizeEnum(claim.claimType || claim.coverageType) || "—",
    statusKey: toStatusKey({
      processed: fraud.processed,
      claimStatus: claim.claimStatus,
      fraudFlag: fraud.fraudFlag,
    }),
    scoredAtLabel: toMonoTimestamp(review?.createdAt || fraud.processedAt),
    scoredBy: review?.agentName || "agent",
    computedScore,
    scoreLabel: computedScore === null ? "—" : `${toScoreLabel(computedScore)} / ${MAX_SCORE}`,
    // Only state a capping event when one actually happened.
    cappingNote:
      rawScore !== null && computedScore !== null && rawScore > computedScore
        ? `Raw score ${rawScore}, capped at the maximum of ${MAX_SCORE}.`
        : null,
    patternsNote:
      review?.patternsEvaluatedCount != null
        ? `${matchedPatterns.length} patterns matched out of ${review.patternsEvaluatedCount} active patterns evaluated`
        : `${matchedPatterns.length} patterns matched`,
    steps: review?.steps || [],
    matchedPatterns,
    similarClaims,
    decision: toDecision(fraud),
  };
}

/** Scored-but-undecided is the only state that offers the action buttons. */
function toDecision(fraud) {
  const state =
    fraud.fraudFlag === true
      ? "confirmed"
      : fraud.reviewedBy && fraud.fraudFlag === false
        ? "dismissed"
        : "pending";

  return {
    state,
    reviewedBy: fraud.reviewedBy || null,
    reviewedAtLabel: toMonoTimestamp(fraud.reviewedAt),
    dismissReason: fraud.dismissReason || null,
  };
}
