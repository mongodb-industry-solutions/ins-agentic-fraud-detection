"use client";

import { useEffect, useMemo, useState } from "react";

import { getCustomer } from "@/lib/api/customers";
import {
  toCustomerClaimRows,
  toCustomerHeader,
  toPolicyRows,
} from "@/lib/customersPresenter";

/** One customer, with their policies and claim summaries, from one fetch. */
export default function useCustomerDetail(customerId) {
  const [customer, setCustomer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setCustomer(null);

    getCustomer(customerId)
      .then((data) => {
        if (!controller.signal.aborted) setCustomer(data);
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [customerId]);

  return {
    isLoading,
    error,
    header: useMemo(() => (customer ? toCustomerHeader(customer) : null), [customer]),
    policyRows: useMemo(() => toPolicyRows(customer?.policies), [customer]),
    claimRows: useMemo(() => toCustomerClaimRows(customer?.claims), [customer]),
  };
}
