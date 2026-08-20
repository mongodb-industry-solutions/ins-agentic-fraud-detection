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

/** Source Code Pro is always all-caps outside real code: "AUG 14", never "Aug 14". */
export function toMonoDate(value) {
  if (!value) return "—";
  return new Date(value)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/** Scores are shown as two-digit integers inside a Lavender chip. */
export function toScoreLabel(score) {
  if (score === null || score === undefined) return null;
  return String(Math.round(score * 100));
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
    coverage: claim.coverageType || claim.claimType || "—",
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
