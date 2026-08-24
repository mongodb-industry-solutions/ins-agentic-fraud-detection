"use client";

import { useCallback, useEffect, useState } from "react";

import { listFraudPatterns, updateFraudPattern } from "@/lib/api/fraudPatterns";
import { PATTERN_TYPE, toPatternCardViewModel } from "@/lib/fraudPatternsPresenter";

/**
 * The whole catalogue in one request, split by pattern type for the two
 * columns. One fetch rather than two filtered ones: the route is unpaginated
 * and the set is small, so a second round trip would buy nothing.
 */
export default function useFraudPatterns() {
  const [rules, setRules] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    listFraudPatterns({ patternType: "ALL" })
      .then((response) => {
        if (cancelled) return;
        const all = (response?.patterns || []).map(toPatternCardViewModel);
        setRules(all.filter((pattern) => pattern.patternType === PATTERN_TYPE.RULE));
        setPatterns(all.filter((pattern) => pattern.patternType === PATTERN_TYPE.SIMILARITY));
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
  }, []);

  /**
   * Flips `active` optimistically, then persists. The state lives here rather
   * than inside the card so the header's active count and the card can never
   * disagree — and so a failed write rolls both back together.
   *
   * Resolves with an error message when the write failed, null when it stuck:
   * the card owns the message, this owns the data.
   */
  const setActive = useCallback(async (patternId, nextActive) => {
    const apply = (value) => (list) =>
      list.map((pattern) => (pattern.id === patternId ? { ...pattern, active: value } : pattern));

    setRules(apply(nextActive));
    setPatterns(apply(nextActive));

    try {
      await updateFraudPattern(patternId, { active: nextActive });
      return null;
    } catch (writeError) {
      setRules(apply(!nextActive));
      setPatterns(apply(!nextActive));
      return writeError.message;
    }
  }, []);

  /**
   * Replaces one card from a pattern the API just returned — the edit form's
   * save path. Keyed by id and applied to both lists because patternType is not
   * editable, so a pattern can never change columns.
   */
  const applyUpdate = useCallback((updatedPattern) => {
    const card = toPatternCardViewModel(updatedPattern);
    const replace = (list) =>
      list.map((pattern) => (pattern.id === card.id ? card : pattern));
    setRules(replace);
    setPatterns(replace);
  }, []);

  /**
   * Adds a newly created pattern to its column, from the document the API
   * returned. Appended locally rather than refetching the catalogue: the
   * response is the same shape the list returns, so a round trip would only
   * re-fetch fifteen patterns to learn about one.
   */
  const addPattern = useCallback((newPattern) => {
    const card = toPatternCardViewModel(newPattern);
    const target = card.patternType === PATTERN_TYPE.RULE ? setRules : setPatterns;
    target((list) => [...list, card]);
  }, []);

  return { rules, patterns, isLoading, error, setActive, applyUpdate, addPattern };
}
