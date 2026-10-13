"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listCustomers } from "@/lib/api/customers";
import { toCustomerList, toCustomerSortControl } from "@/lib/customersPresenter";

/**
 * Search and sort are server-side: both are query params on list_customers, so
 * the directory doesn't have to be fully loaded client-side to be filtered.
 */
export default function useCustomersList() {
  const [response, setResponse] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("-customerSince");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    // Typing shouldn't fire a request per keystroke.
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await listCustomers({ search: search.trim(), sort, limit: 100 });
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
  }, [search, sort]);

  const list = useMemo(() => toCustomerList(response), [response]);
  const sortControl = useMemo(() => toCustomerSortControl(sort), [sort]);

  return {
    ...list,
    search,
    setSearch: useCallback((value) => setSearch(value), []),
    sortControl,
    changeSort: setSort,
    isLoading,
    error,
  };
}
