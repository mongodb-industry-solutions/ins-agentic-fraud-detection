"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listClaims } from "@/lib/api/claims";
import { getFinancialImpact, getPortfolioStats } from "@/lib/api/fraud";

import { QUEUE_STATUS } from "@/components/assessmentQueue/useAssessmentQueue";
import {
  toClaimRows,
  toPortfolioCounts,
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
   always recomputed from the rows actually in view, below.

   Severe and Simple are score bands over *assessed* claims (see
   claimsPresenter.toSegment), so an unanalyzed claim appears under neither and
   the two counts do not add up to "All claims". That is the intent: a claim the
   agent has not scored has no fraud severity to sort it by. */
const SEGMENTS = [
  { id: "all", label: "All claims" },
  { id: "severe", label: "Severe" },
  { id: "simple", label: "Simple" },
];

export const PAGE_SIZE = 10;

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
export default function useDashboard(queueJobs = []) {
  const [activeSegment, setActiveSegment] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState([]);
  // Which claim's fraud report is open, or null. One drawer at a time — a
  // similar-claim link replaces the open report rather than stacking on it.
  const [reportClaimId, setReportClaimId] = useState(null);

  const [claimList, setClaimList] = useState(EMPTY_CLAIM_LIST);
  const [page, setPage] = useState(1);
  const [trends, setTrends] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setIsLoading(true);
      // `allSettled`, not `all`: the sparkline and the cost-avoided card are
      // secondary to the claims table, and one failing must not blank out the
      // whole dashboard.
      const [claims, portfolio, impact] = await Promise.allSettled([
        // The table filters client-side, so it needs the whole portfolio rather
        // than a page of it.
        listClaims({ limit: 200 }),
        getPortfolioStats(),
        getFinancialImpact(),
      ]);
      if (controller.signal.aborted) return;

      if (claims.status === "fulfilled") {
        setClaimList(claims.value);
        setError(null);
      } else {
        setError(claims.reason?.message || "Could not load claims.");
      }
      if (portfolio.status === "fulfilled") setTrends(toSparklines(portfolio.value));
      if (impact.status === "fulfilled") setFinancial(impact.value);
      setIsLoading(false);
    })();

    return () => controller.abort();
  }, []);

  // "Pending review" is a queue state the claims API cannot see: a claim is
  // pending only while its job is ready for review in the Fraud Assessment Queue.
  const queuedClaimIds = useMemo(
    () =>
      new Set(
        queueJobs
          .filter((job) => job.status === QUEUE_STATUS.READY_FOR_REVIEW)
          .map((job) => job.claimId)
      ),
    [queueJobs]
  );

  const counts = useMemo(
    () => toPortfolioCounts(claimList, queuedClaimIds.size),
    [claimList, queuedClaimIds]
  );
  const portfolioRows = useMemo(
    () => toClaimRows(claimList, queuedClaimIds),
    [claimList, queuedClaimIds]
  );
  const dateSpan = useMemo(() => {
    const dates = portfolioRows.map((row) => row.openedAt).filter((value) => value !== null);
    return dates.length ? { from: Math.min(...dates), to: Math.max(...dates) } : null;
  }, [portfolioRows]);
  const stats = useMemo(
    () => toStatStrip(counts, trends || {}, { financial, dateSpan }),
    [counts, trends, financial, dateSpan]
  );
  const breakdown = useMemo(() => toStatusBreakdown(counts), [counts]);
  const summary = useMemo(() => toPortfolioSummary(counts), [counts]);

  // The two halves of the portfolio live in different places: claims nobody has
  // analysed wait in the "Pending assessment" panel, and the table below it
  // lists only claims the agent has already assessed.
  const pendingAssessment = useMemo(
    () => applySort(portfolioRows.filter((row) => row.isUnprocessed), "newest"),
    [portfolioRows]
  );
  const allRows = useMemo(() => portfolioRows.filter((row) => !row.isUnprocessed), [portfolioRows]);

  // Filters and segment compose: the chips narrow the set, the segment then
  // splits it. Sorting is applied last so it survives both.
  const filteredRows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);

  const sortedRows = useMemo(() => {
    const segmented =
      activeSegment === "all"
        ? filteredRows
        : filteredRows.filter((row) => row.segment === activeSegment);
    return applySort(segmented, sort);
  }, [filteredRows, activeSegment, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  // Clamped rather than reset by an effect: a refetch can shrink the list under
  // the reader without any of the controls that reset the page having fired.
  const currentPage = Math.min(page, pageCount);
  const rows = useMemo(
    () => sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sortedRows, currentPage]
  );
  const pagination = {
    page: currentPage,
    pageCount,
    total: sortedRows.length,
    from: sortedRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1,
    to: Math.min(currentPage * PAGE_SIZE, sortedRows.length),
  };

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

  /* Off everywhere for now. The checkbox column fed /claims/batch/select, which
     accepts only claims that have NOT been processed — and every segment that
     used to carry checkboxes now shows processed claims exclusively, so every
     box would be rejected on submit. The selection machinery below is left
     intact for when batch processing gets an entry point that matches it. */
  const showCheckboxes = false;

  const changeSegment = useCallback((segmentId) => {
    setActiveSegment(segmentId);
    setSelectedIds([]);
    setPage(1);
  }, []);

  // Any filter change can remove a checked row from view, so the selection is
  // dropped rather than left holding rows the user can no longer see.
  const changeFilter = useCallback((filterId, optionId) => {
    setFilters((current) => ({ ...current, [filterId]: optionId }));
    setSelectedIds([]);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSelectedIds([]);
    setPage(1);
  }, []);

  const changeSort = useCallback((sortId) => {
    setSort(sortId);
    setPage(1);
  }, []);

  const toggleRow = useCallback((rowId) => {
    setSelectedIds((current) =>
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId]
    );
  }, []);

  const openReport = useCallback((claimId) => setReportClaimId(claimId), []);
  const closeReport = useCallback(() => setReportClaimId(null), []);

  return {
    isLoading,
    error,
    segments,
    activeSegment,
    changeSegment,
    summary,
    stats,
    breakdown,
    pendingAssessment,
    filterControls,
    sortControl,
    hasFilters: hasActiveFilters(filters),
    changeFilter,
    changeSort,
    clearFilters,
    rows,
    pagination,
    changePage: setPage,
    // Row status by claim, for the report drawer's pill: it cannot see the
    // queue itself and must not contradict the table it was opened from.
    rowById: Object.fromEntries(allRows.map((row) => [row.claimId, row])),
    showCheckboxes,
    selectedIds,
    toggleRow,
    reportClaimId,
    openReport,
    closeReport,
  };
}
