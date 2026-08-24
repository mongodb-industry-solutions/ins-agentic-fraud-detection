"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getFraudPatternDetail } from "@/lib/api/fraudPatterns";
import { toPatternDetailViewModel } from "@/lib/fraudPatternsPresenter";

/**
 * Fetches on open, keyed by patternId. The matched-claims join is the expensive
 * part of this response, which is why the list view does not carry it and this
 * only runs once a pattern is actually opened.
 *
 * The raw pattern and its matched claims are held separately so a write can
 * replace the pattern without discarding the claims — PATCH returns the updated
 * pattern but not the join, and refetching the whole thing to redraw a changed
 * severity would be a round trip for nothing.
 */
export default function useFraudPatternDetail(patternId) {
  const [pattern, setPattern] = useState(null);
  const [matchedClaims, setMatchedClaims] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!patternId) {
      setPattern(null);
      setMatchedClaims([]);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);
    // Cleared up front so a slow second open never shows the first pattern's data.
    setPattern(null);

    getFraudPatternDetail(patternId)
      .then((response) => {
        if (cancelled) return;
        setPattern(response.pattern);
        setMatchedClaims(response.matchedClaims || []);
        setError(null);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [patternId]);

  /* Safe to swap in a pattern from a write response: every endpoint returns the
     same public shape, vector replaced by the `hasEmbedding` flag. */
  const applyUpdate = useCallback((updatedPattern) => setPattern(updatedPattern), []);

  const detail = useMemo(
    () => (pattern ? toPatternDetailViewModel(pattern, matchedClaims) : null),
    [pattern, matchedClaims]
  );

  return { detail, isLoading, error, applyUpdate };
}
