/**
 * Backend docs -> view models. Components never touch raw API JSON; they read
 * only the flat, already-formatted objects this file returns.
 */

/** The four states, and the only status keys any component is allowed to see. */
export const STATUS = {
  UNPROCESSED: "unprocessed",
  // Scored by the agent but not in the Fraud Assessment Queue, so nobody is
  // being asked to review it right now.
  ASSESSED: "assessed",
  PENDING: "pending",
  FLAGGED: "flagged",
  CLEARED: "cleared",
};

export const STATUS_LABEL = {
  [STATUS.UNPROCESSED]: "Not yet analyzed",
  [STATUS.ASSESSED]: "Assessed",
  [STATUS.PENDING]: "Pending review",
  [STATUS.FLAGGED]: "Confirmed fraud",
  [STATUS.CLEARED]: "Cleared — no fraud",
};

/**
 * The claim's *fraud review* state — not its lifecycle. `claimStatus` is the
 * lifecycle field (OPEN / CLOSED / CLOSED_DENIED) and is deliberately not
 * consulted here: a closed claim can hold any fraud state, and vice versa.
 *
 * Branch order mirrors the backend's stats facet and STATUS_MATCHES exactly, so
 * a row can never disagree with the stat card counting it.
 */
function toStatusKey(claim) {
  if (claim.fraudFlag === true) return STATUS.FLAGGED;
  if (claim.processed !== true) return STATUS.UNPROCESSED;
  // Previously this tested `claimStatus === "CLEARED"`, a value the API never
  // returns, so every cleared claim fell through to PENDING — closed claims
  // with a decision on record were all mislabelled "Pending review".
  if (claim.fraudFlag === false) return STATUS.CLEARED;
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

/**
 * Currency. Whole amounts show no decimals; fractional ones always show two,
 * so a stored 1201.1 renders "$1,201.10" rather than the "$1,201.1" a plain
 * toLocaleString produces.
 */
export function toMoney(amount) {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const decimals = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** The agent's raw score is capped at this many points. */
export const MAX_SCORE = 12;

/**
 * Where the severe segment starts on the 0..12 capped scale: the agent's
 * PRIORITY band (9-12), as also used by the backend's SCORE_BANDS. The other
 * two bands (0-3 fast-track, 4-8 review) make up the "simple" segment.
 */
export const SEVERE_SCORE_MIN = 9;

/**
 * Which dashboard segment a claim belongs to, or null for neither.
 *
 * Derived from the fraud score, NOT from the stored `complexity` field.
 * `complexity` is operational triage metadata written when the claim is
 * created — how hard the claim is to handle — so it says nothing about fraud
 * severity and is set on claims the agent has never looked at.
 *
 * An unscored claim is in neither band: it is not a low-scoring claim, it is a
 * claim with no score, and it stays visible under "All claims".
 */
function toSegment(claim) {
  if (claim.processed !== true || claim.computedScore === null || claim.computedScore === undefined) {
    return null;
  }
  return claim.computedScore >= SEVERE_SCORE_MIN ? "severe" : "simple";
}

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

/**
 * One claims-table row.
 *
 * "Pending review" means a human is being asked to decide: the claim is assessed
 * AND its job is sitting in the Fraud Assessment Queue as ready for review. An
 * assessed, undecided claim that is not in the queue is just "Assessed".
 * `queuedClaimIds` is the set of claim ids with a READY_FOR_REVIEW job.
 */
export function toClaimRow(claim, queuedClaimIds = new Set()) {
  let statusKey = toStatusKey(claim);
  if (statusKey === STATUS.PENDING && !queuedClaimIds.has(claim.claimId)) {
    statusKey = STATUS.ASSESSED;
  }
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
    // Drives which segment filter the row survives; "all" always matches, and
    // null survives only "all".
    segment: toSegment(claim),
    isUnprocessed: statusKey === STATUS.UNPROCESSED,
  };
}

export function toClaimRows(response, queuedClaimIds) {
  return (response?.claims || []).map((claim) => toClaimRow(claim, queuedClaimIds));
}

/**
 * The portfolio split every dashboard widget reads, so the stat cards, the donut
 * and the header can never disagree.
 *
 * The API cannot see the queue, so its `pendingReview` bucket (assessed, no
 * decision) is divided here: the claims with a ready-for-review job are
 * "pending review", the rest are merely "assessed".
 */
export function toPortfolioCounts(response, readyForReviewCount = 0) {
  const stats = response?.stats || {};
  const undecided = stats.pendingReview ?? 0;
  const pending = Math.min(readyForReviewCount, undecided);
  const unprocessed = stats.unprocessed ?? 0;
  const flagged = stats.flagged ?? 0;
  const cleared = stats.cleared ?? 0;
  return {
    unprocessed,
    assessed: undecided - pending,
    pending,
    flagged,
    cleared,
    total: stats.total ?? unprocessed + undecided + flagged + cleared,
  };
}

/** "$1.2M" — the strip's value slot is too narrow for a full-precision amount. */
function toCompactMoney(amount) {
  const value = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * The four headline cards, in fixed order. `tone` picks each card's colour from
 * the brand green ramp (see StatStrip.module.css). They answer what the donut beside
 * them cannot — how big the portfolio is, how much work is waiting, how much of
 * it is fraud, and what that is worth — rather than repeating its status counts.
 *
 *   counts    — toPortfolioCounts, the same split the donut draws
 *   financial — GET /fraud/financial-impact, or null if it failed to load
 *   dateSpan  — { from, to } claim-open timestamps of the claims in view
 *
 * Fraud-vs-cleared is over *decided* claims only: an undecided claim is neither,
 * and counting it would dilute the rate.
 */
export function toStatStrip(counts, trends = {}, { financial = null, dateSpan = null } = {}) {
  const share = (value, whole) => (whole > 0 ? Math.round((value / whole) * 100) : 0);

  const decided = counts.flagged + counts.cleared;
  const fraudPct = share(counts.flagged, decided);
  const unprocessedPct = share(counts.unprocessed, counts.total);

  const avoided = financial?.fraudCostAvoided;
  const exposure = financial?.potentialImpactWithoutTool;
  const avoidedPct = share(avoided, exposure);

  return [
    {
      id: "total",
      label: "Claims in portfolio",
      hint: "Every claim on record",
      value: String(counts.total),
      tone: "forest",
      icon: "file",
      footnote: dateSpan
        ? `Opened ${toMonoDateFull(dateSpan.from)} – ${toMonoDateFull(dateSpan.to)}`
        : null,
    },
    {
      id: "pendingAssessment",
      label: "Pending assessment",
      hint: "Claims the agent has not analyzed yet",
      value: String(counts.unprocessed),
      tone: "leaf",
      icon: "clock",
      sparkline: { points: trends.unprocessed || [], tone: "leaf" },
      bar: [{ pct: unprocessedPct, tone: "tone" }],
      footnote: `${unprocessedPct}% of portfolio`,
    },
    {
      id: "fraudRate",
      label: "Fraud vs cleared",
      hint: decided ? `Of ${decided} decided claims` : "No claims decided yet",
      value: decided ? `${fraudPct}%` : "—",
      tone: "spring",
      icon: "activity",
      bar: decided
        ? [
            { pct: fraudPct, tone: "tone" },
            { pct: 100 - fraudPct, tone: "muted" },
          ]
        : null,
      footnote: decided ? `${fraudPct}% fraud · ${100 - fraudPct}% cleared` : null,
    },
    {
      id: "costAvoided",
      label: "Fraud cost avoided",
      hint: "Claims caught before payout",
      value: toCompactMoney(avoided),
      tone: "chartreuse",
      icon: "shield",
      bar: exposure > 0 ? [{ pct: avoidedPct, tone: "tone" }] : null,
      footnote: exposure > 0 ? `${avoidedPct}% of ${toCompactMoney(exposure)} exposure` : null,
    },
  ];
}

/** Donut segments + legend rows. Colors match the status pills exactly. */
export function toStatusBreakdown(counts) {
  const segments = [
    { statusKey: STATUS.UNPROCESSED, count: counts.unprocessed },
    { statusKey: STATUS.ASSESSED, count: counts.assessed },
    { statusKey: STATUS.PENDING, count: counts.pending },
    { statusKey: STATUS.FLAGGED, count: counts.flagged },
    { statusKey: STATUS.CLEARED, count: counts.cleared },
  ].map((segment) => ({ ...segment, label: STATUS_LABEL[segment.statusKey] }));
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  return { total, segments };
}

/** Header copy for the page title block. */
export function toPortfolioSummary(counts) {
  return `${counts.total} claims in portfolio — ${counts.pending} awaiting your decision`;
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
/**
 * "How the agent got here" as {id, label} rows.
 *
 * Two shapes reach this. A decision trace records `steps` as objects — one per
 * pattern that fired, carrying the comparison that fired it — while the offline
 * fixture uses plain narration strings. Both are normalised here rather than in
 * the drawer, which renders view models and never raw API JSON.
 *
 * The id matters: the drawer used the step itself as its React key, which was
 * fine for unique strings and produced duplicate `[object Object]` keys the
 * moment real traces arrived.
 */
function toReportSteps(steps) {
  return (steps || [])
    .map((step, index) => {
      if (typeof step === "string") {
        return step.trim() ? { id: `step-${index}`, label: step } : null;
      }
      if (!step || typeof step !== "object") return null;

      const name = step.patternName || step.patternId || "Pattern evaluated";
      return {
        id: step.patternId || `step-${index}`,
        // The detail IS the evidence ("claimAmount=35000 > 25000"), so it is
        // kept verbatim next to the pattern it justifies.
        label: step.detail ? `${name} — ${step.detail}` : name,
      };
    })
    .filter(Boolean);
}

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
    steps: toReportSteps(review?.steps),
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
