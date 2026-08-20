import { REFERENCE_NOW, STATUS, STATUS_LABEL } from "./claimsPresenter";

/**
 * Filter/sort option lists and the pure functions that apply them.
 *
 * Options are derived from the rows themselves where the data decides them
 * (coverage types) and fixed where the product decides them (statuses, date
 * ranges, sort orders). Everything here is a view model: no component builds
 * an option list or compares a raw field by hand.
 */

const ANY = "all";

/* Ranges are scaled to how fast claims actually arrive — a portfolio this
   size turns over in days, so 30/60/90-day buckets would all return the whole
   table and read as a broken control. */
export const DATE_RANGES = [
  { id: ANY, label: "Any date" },
  { id: "1d", label: "Last 24 hours", days: 1 },
  { id: "3d", label: "Last 3 days", days: 3 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
];

export const SORT_OPTIONS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "scoreDesc", label: "Highest score" },
  { id: "scoreAsc", label: "Lowest score" },
];

export const DEFAULT_FILTERS = { status: ANY, coverage: ANY, date: ANY };
export const DEFAULT_SORT = "newest";

const STATUS_ORDER = [STATUS.UNPROCESSED, STATUS.PENDING, STATUS.FLAGGED, STATUS.CLEARED];

/** The three filter chips, each with its own option list and current label. */
export function toFilterControls(rows, filters) {
  const coverages = [...new Set(rows.map((row) => row.coverage))].sort();

  const controls = [
    {
      id: "status",
      label: "Status",
      options: [
        { id: ANY, label: "Any status" },
        ...STATUS_ORDER.map((key) => ({ id: key, label: STATUS_LABEL[key] })),
      ],
    },
    {
      id: "coverage",
      label: "Coverage type",
      options: [
        { id: ANY, label: "Any coverage" },
        ...coverages.map((coverage) => ({ id: coverage, label: coverage })),
      ],
    },
    {
      id: "date",
      label: "Date opened",
      options: DATE_RANGES.map(({ id, label }) => ({ id, label })),
    },
  ];

  return controls.map((control) => {
    const selectedId = filters[control.id] ?? ANY;
    const selected = control.options.find((option) => option.id === selectedId);
    return {
      ...control,
      selectedId,
      isActive: selectedId !== ANY,
      // An active chip shows what it is filtering by, not just its own name.
      buttonLabel: selectedId === ANY ? control.label : `${control.label}: ${selected?.label}`,
    };
  });
}

export function toSortControl(sortId) {
  const selected = SORT_OPTIONS.find((option) => option.id === sortId) || SORT_OPTIONS[0];
  return {
    id: "sort",
    selectedId: selected.id,
    options: SORT_OPTIONS,
    buttonLabel: `Sort: ${selected.label.toLowerCase()}`,
  };
}

export function hasActiveFilters(filters) {
  return Object.values(filters).some((value) => value !== ANY);
}

export function applyFilters(rows, filters) {
  const range = DATE_RANGES.find((option) => option.id === filters.date);
  const cutoff = range?.days ? REFERENCE_NOW - range.days * 86400000 : null;

  return rows.filter((row) => {
    if (filters.status !== ANY && row.statusKey !== filters.status) return false;
    if (filters.coverage !== ANY && row.coverage !== filters.coverage) return false;
    if (cutoff !== null && (row.openedAt === null || row.openedAt < cutoff)) return false;
    return true;
  });
}

/** Unscored claims always sort last, either way — a missing score is not a low one. */
function compareScore(a, b, direction) {
  if (a.scoreValue === null && b.scoreValue === null) return 0;
  if (a.scoreValue === null) return 1;
  if (b.scoreValue === null) return -1;
  return direction * (b.scoreValue - a.scoreValue);
}

export function applySort(rows, sortId) {
  const sorted = [...rows];
  switch (sortId) {
    case "oldest":
      return sorted.sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
    case "scoreDesc":
      return sorted.sort((a, b) => compareScore(a, b, 1));
    case "scoreAsc":
      return sorted.sort((a, b) => compareScore(a, b, -1));
    default:
      return sorted.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  }
}
