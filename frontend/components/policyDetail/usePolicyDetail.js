"use client";

import { useEffect, useMemo, useState } from "react";

import { getPolicy } from "@/lib/api/policies";
import { toPolicyDetail } from "@/lib/policiesPresenter";

/** One policy with its customer and claims, from one fetch. */
export default function usePolicyDetail(policyId) {
  const [policy, setPolicy] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setPolicy(null);

    getPolicy(policyId)
      .then((data) => {
        if (!controller.signal.aborted) setPolicy(data);
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [policyId]);

  return {
    isLoading,
    error,
    detail: useMemo(() => (policy ? toPolicyDetail(policy) : null), [policy]),
  };
}
