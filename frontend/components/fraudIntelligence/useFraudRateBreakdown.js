"use client";

import { useEffect, useState } from "react";

import { getFraudRateBreakdown } from "@/lib/api/fraud";

/**
 * One breakdown per dimension. Both the chart and the table read this.
 *
 * `data` is cleared and `isLoading` set back to true the moment `dimension`
 * changes, before the new request is even issued. That ordering is the point:
 * leaving the previous dimension's rows on screen under the new dimension's
 * heading would show, say, coverage-type bars labelled as claim-amount buckets
 * for as long as the fetch took — wrong data that looks entirely plausible.
 */
export default function useFraudRateBreakdown(dimension) {
  const [state, setState] = useState({ data: null, isLoading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, isLoading: true, error: null });

    getFraudRateBreakdown(dimension)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          isLoading: false,
          error: error.message || "Couldn't load the fraud rate breakdown.",
        });
      });

    return () => controller.abort();
  }, [dimension]);

  return state;
}
