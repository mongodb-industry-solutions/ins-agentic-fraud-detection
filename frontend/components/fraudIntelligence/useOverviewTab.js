"use client";

import { useEffect, useState } from "react";

import { listClaims } from "@/lib/api/claims";
import { getFinancialImpact, getPortfolioStats } from "@/lib/api/fraud";
import { listFraudPatterns } from "@/lib/api/fraudPatterns";

const IDLE = { data: null, isLoading: true, error: null };

/**
 * The Overview tab's data, as three independently-resolving requests.
 *
 * Independent on purpose. The financial bars, the histogram and the KPI strip
 * read from different endpoints, and a slow or failing `financial-impact` must
 * not blank out a histogram that already has everything it needs. Each section
 * therefore gets its own loading and error flags and renders its own state —
 * there is no single top-level spinner gating the screen.
 *
 * `portfolio-stats` is fetched once here and shared by the KPI strip and the
 * histogram rather than being called twice from two child hooks.
 *
 * The flagged count is read from `list_claims`'s existing stats facet, not
 * recomputed. That is the whole reason it is fetched here at all: the Dashboard
 * already shows this number from that facet, and computing it a second way
 * would create two paths to one figure that could disagree on screen.
 */
export default function useOverviewTab() {
  const [financial, setFinancial] = useState(IDLE);
  const [portfolio, setPortfolio] = useState(IDLE);
  const [reference, setReference] = useState(IDLE);

  useEffect(() => {
    const controller = new AbortController();

    /** Resolves one request into its own slice of state. */
    function load(request, setState, describe) {
      request
        .then((data) => {
          if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setState({ data: null, isLoading: false, error: error.message || describe });
        });
    }

    load(getFinancialImpact(), setFinancial, "Couldn't load financial impact.");
    load(getPortfolioStats(), setPortfolio, "Couldn't load portfolio statistics.");

    // The KPI strip's two remaining cells come from two different endpoints, so
    // they are fetched together and fail together — the strip is one zone and
    // cannot usefully render half-loaded.
    load(
      Promise.all([
        // `limit: 1` because only the stats facet is wanted here; the facet is
        // computed over the whole segment regardless of the page size, so this
        // asks for one row instead of two hundred to get the same counts.
        listClaims({ limit: 1 }),
        listFraudPatterns({ active: true }),
      ]).then(([claims, patterns]) => ({
        flaggedCount: claims?.stats?.flagged ?? null,
        activePatternCount: patterns?.total ?? null,
      })),
      setReference,
      "Couldn't load reference counts."
    );

    return () => controller.abort();
  }, []);

  return {
    financial,
    portfolio,
    reference,
    // The strip needs both requests in before it can fill every cell.
    isKpiLoading: portfolio.isLoading || reference.isLoading,
    kpiError: portfolio.error || reference.error,
  };
}
