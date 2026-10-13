"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listPolicies } from "@/lib/api/policies";
import {
  toPolicyFilterControls,
  toPolicyList,
  toPolicySortControl,
} from "@/lib/policiesPresenter";

const DEFAULT_FILTERS = { status: "all", coverageType: "all" };
const DEFAULT_SORT = "-effectivePeriod.endDate";

/**
 * Search, both filters and sort are all query params on list_policies, so every
 * narrowing happens server-side rather than over a fully-loaded client list.
 */
export default function usePoliciesList() {
  const [response, setResponse] = useState(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await listPolicies({
          search: search.trim(),
          // "all" is this UI's word for unfiltered; the backend's is "ALL".
          status: filters.status === "all" ? "ALL" : filters.status,
          coverageType: filters.coverageType === "all" ? "ALL" : filters.coverageType,
          sort,
          limit: 100,
        });
        if (!controller.signal.aborted) setResponse(data);
      } catch (fetchError) {
        if (!controller.signal.aborted) setError(fetchError.message);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, search ? 250 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, filters, sort]);

  const list = useMemo(() => toPolicyList(response), [response]);

  return {
    ...list,
    search,
    setSearch,
    filterControls: useMemo(() => toPolicyFilterControls(filters), [filters]),
    sortControl: useMemo(() => toPolicySortControl(sort), [sort]),
    changeFilter: useCallback(
      (filterId, optionId) => setFilters((current) => ({ ...current, [filterId]: optionId })),
      []
    ),
    changeSort: setSort,
    isLoading,
    error,
  };
}
