"use client";

import { useEffect, useState } from "react";

import { getPatternCooccurrence } from "@/lib/api/fraud";
import { getTopPatternsLeaderboard } from "@/lib/api/fraudPatterns";

const IDLE = { data: null, isLoading: true, error: null };

/**
 * The Patterns sub-tab's two fetches, resolving independently.
 *
 * Two requests, two states: the co-occurrence matrix is the heavier computation
 * of the pair, and a slow or failed one must leave the leaderboard fully
 * readable.
 *
 * Neither request is parameterised by UI state, so both run once on mount.
 * There is deliberately no third fetch: the reliability-trends section is a
 * static placeholder, because the endpoint behind it does not exist yet and
 * calling one that cannot answer would flash an error before settling.
 */
export default function usePatternsTab() {
  const [leaderboard, setLeaderboard] = useState(IDLE);
  const [cooccurrence, setCooccurrence] = useState(IDLE);

  useEffect(() => {
    const controller = new AbortController();

    function load(request, setState, fallbackMessage) {
      request
        .then((data) => {
          if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setState({ data: null, isLoading: false, error: error.message || fallbackMessage });
        });
    }

    load(
      getTopPatternsLeaderboard({ limit: 5 }),
      setLeaderboard,
      "Couldn't load the top patterns leaderboard."
    );
    load(
      getPatternCooccurrence({ minCooccurrence: 2 }),
      setCooccurrence,
      "Couldn't load pattern co-occurrence data."
    );

    return () => controller.abort();
  }, []);

  return { leaderboard, cooccurrence };
}
