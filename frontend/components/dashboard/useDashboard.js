"use client";

import { useCallback, useMemo, useState } from "react";

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
import {
  DEMO_ACTIVITY,
  DEMO_CLAIM_LIST,
  DEMO_PENDING_QUEUE,
  DEMO_SEGMENTS,
  DEMO_STAT_TRENDS,
} from "@/lib/const/demoClaims";

/**
 * All dashboard state. Data comes from lib/const for this build; swapping in
 * lib/api/claims.js + lib/api/fraud.js means changing only the three raw
 * values below — the presenters and components stay untouched.
 */
export default function useDashboard() {
  const [activeSegment, setActiveSegment] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState([]);

  const claimList = DEMO_CLAIM_LIST;

  const stats = useMemo(() => toStatStrip(claimList, DEMO_STAT_TRENDS), [claimList]);
  const breakdown = useMemo(() => toStatusBreakdown(claimList), [claimList]);
  const summary = useMemo(() => toPortfolioSummary(claimList), [claimList]);
  const allRows = useMemo(() => toClaimRows(claimList), [claimList]);
  const pendingQueue = useMemo(() => toPendingQueue(DEMO_PENDING_QUEUE), []);
  const activityFeed = useMemo(() => toActivityFeed(DEMO_ACTIVITY), []);

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
      DEMO_SEGMENTS.map((segment) => ({
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

  return {
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
  };
}
