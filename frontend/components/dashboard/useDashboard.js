"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listClaims } from "@/lib/api/claims";
import { getPendingQueue, getPortfolioStats, getRecentActivity } from "@/lib/api/fraud";

import { toActivityFeed } from "@/lib/activityPresenter";
import {
  toClaimRows,
  toPendingQueue,
  toPortfolioSummary,
  toStatStrip,
  toStatusBreakdown,
} from "@/lib/claimsPresenter";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  applyFilters,
  applySort,
  hasActiveFilters,
  toFilterControls,
  toSortControl,
} from "@/lib/filtersPresenter";
/* Segment labels are UI configuration, not data — the counts beside them are
   always recomputed from the rows actually in view, below. */
const SEGMENTS = [
  { id: "all", label: "All claims" },
  { id: "complex", label: "Complex" },
  { id: "simple", label: "Simple" },
];

const EMPTY_CLAIM_LIST = { stats: {}, claims: [], total: 0, page: 1, limit: 0 };

/**
 * Turns `/fraud/portfolio-stats` buckets into the two sparkline series the stat
 * cards draw. Returns empty arrays when the window holds no buckets, which the
 * Sparkline component renders as nothing rather than a flat fake line.
 */
function toSparklines(portfolio) {
  const trend = portfolio?.trend || [];
  return {
    unprocessed: trend.map((bucket) => bucket.unprocessed ?? 0),
    flagged: trend.map((bucket) => bucket.flagged ?? 0),
  };
}

/**
 * All dashboard state, over live API data.
 *
 * Everything is fetched once on mount and the whole set is filtered, segmented
 * and sorted in the browser. That is deliberate for a demo-sized portfolio: the
 * segment counts and stat cards have to agree with the table, and computing them
 * from one snapshot is what guarantees that. It would need to move server-side
 * before the claim count got large.
 */
export default function useDashboard() {
  const [activeSegment, setActiveSegment] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState([]);
  // Which claim's fraud report is open, or null. One drawer at a time — a
  // similar-claim link replaces the open report rather than stacking on it.
  const [reportClaimId, setReportClaimId] = useState(null);

  const [claimList, setClaimList] = useState(EMPTY_CLAIM_LIST);
  const [pendingRaw, setPendingRaw] = useState(null);
  const [activityRaw, setActivityRaw] = useState(null);
  const [trends, setTrends] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setIsLoading(true);
      // `allSettled`, not `all`: the portfolio-stats sparkline and the activity
      // feed are decorative next to the claims table, and one of them failing
      // must not blank out the whole dashboard.
      const [claims, pending, activity, portfolio] = await Promise.allSettled([
        // The table filters client-side, so it needs the whole portfolio rather
        // than a page of it.
        listClaims({ limit: 200 }),
        getPendingQueue({ limit: 10 }),
        // The zone shows the agent's five most recent actions from the past
        // week — windowed server-side so the limit counts events inside the
        // window rather than trimming a wider list down to five.
        getRecentActivity({ limit: 5, days: 7, agentOnly: true }),
        getPortfolioStats(),
      ]);
      if (controller.signal.aborted) return;

      if (claims.status === "fulfilled") {
        setClaimList(claims.value);
        setError(null);
      } else {
        setError(claims.reason?.message || "Could not load claims.");
      }
      if (pending.status === "fulfilled") setPendingRaw(pending.value);
      if (activity.status === "fulfilled") setActivityRaw(activity.value);
      if (portfolio.status === "fulfilled") setTrends(toSparklines(portfolio.value));
      setIsLoading(false);
    })();

    return () => controller.abort();
  }, []);

  const stats = useMemo(() => toStatStrip(claimList, trends || {}), [claimList, trends]);
  const breakdown = useMemo(() => toStatusBreakdown(claimList), [claimList]);
  const summary = useMemo(() => toPortfolioSummary(claimList), [claimList]);
  const allRows = useMemo(() => toClaimRows(claimList), [claimList]);
  const pendingQueue = useMemo(() => toPendingQueue(pendingRaw), [pendingRaw]);
  const activityFeed = useMemo(() => toActivityFeed(activityRaw), [activityRaw]);

  // Filters and segment compose: the chips narrow the set, the segment then
  // splits it. Sorting is applied last so it survives both.
  const filteredRows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);

  const rows = useMemo(() => {
    const segmented =
      activeSegment === "all"
        ? filteredRows
        : filteredRows.filter((row) => row.segment === activeSegment);
    return applySort(segmented, sort);
  }, [filteredRows, activeSegment, sort]);

  // Counts reflect what a click would actually show, so they can't contradict
  // the filters currently applied above them.
  const segments = useMemo(
    () =>
      SEGMENTS.map((segment) => ({
        ...segment,
        count:
          segment.id === "all"
            ? filteredRows.length
            : filteredRows.filter((row) => row.segment === segment.id).length,
      })),
    [filteredRows]
  );

  const filterControls = useMemo(() => toFilterControls(allRows, filters), [allRows, filters]);
  const sortControl = useMemo(() => toSortControl(sort), [sort]);

  // Checkbox column and segment filter are one behavior, not two: checkboxes
  // exist only on "Simple", so switching away also clears the selection.
  const showCheckboxes = activeSegment === "simple";

  const changeSegment = useCallback((segmentId) => {
    setActiveSegment(segmentId);
    setSelectedIds([]);
  }, []);

  // Any filter change can remove a checked row from view, so the selection is
  // dropped rather than left holding rows the user can no longer see.
  const changeFilter = useCallback((filterId, optionId) => {
    setFilters((current) => ({ ...current, [filterId]: optionId }));
    setSelectedIds([]);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSelectedIds([]);
  }, []);

  const toggleRow = useCallback((rowId) => {
    setSelectedIds((current) =>
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId]
    );
  }, []);

  const openReport = useCallback((claimId) => setReportClaimId(claimId), []);
  const closeReport = useCallback(() => setReportClaimId(null), []);

  // The drawer needs a fallback row for claims outside the current page.
  const reportRow = useMemo(
    () => allRows.find((row) => row.claimId === reportClaimId) || null,
    [allRows, reportClaimId]
  );

  return {
    isLoading,
    error,
    segments,
    activeSegment,
    changeSegment,
    summary,
    stats,
    breakdown,
    pendingQueue,
    activityFeed,
    filterControls,
    sortControl,
    hasFilters: hasActiveFilters(filters),
    changeFilter,
    changeSort: setSort,
    clearFilters,
    rows,
    showCheckboxes,
    selectedIds,
    toggleRow,
    reportClaimId,
    reportRow,
    openReport,
    closeReport,
  };
}
