"use client";

import { useCallback, useEffect, useState } from "react";

import { getRelationshipGraph, getRepeatEntities, getSimilarityLeaderboard } from "@/lib/api/fraud";

const IDLE = { data: null, isLoading: true, error: null };

/**
 * The Relationships tab's three fetches.
 *
 * `scope` is shared by the graph and the leaderboard rather than each owning
 * its own: they are two readings of the same relationships, and two scope
 * controls on one screen that could disagree would make the pair incoherent.
 * Changing it refetches both, because scope decides which claims the backend
 * treats as candidates in the first place — it is not a client-side filter over
 * an already-fetched set.
 *
 * `entityType` refetches only the repeat-entity section, for the same reason:
 * the backend requires it as a parameter and there is no combined result to
 * re-slice locally.
 *
 * Each section keeps its own loading and error state so a failure in one leaves
 * the other two fully usable.
 */
export default function useRelationshipsTab() {
  const [scope, setScope] = useState("ALL");
  const [entityType, setEntityType] = useState("customer");

  const [graph, setGraph] = useState(IDLE);
  const [leaderboard, setLeaderboard] = useState(IDLE);
  const [entities, setEntities] = useState(IDLE);

  useEffect(() => {
    const controller = new AbortController();

    // Back to loading on a scope change, so the previous scope's graph is not
    // left on screen looking like a result for the newly selected one.
    setGraph(IDLE);
    setLeaderboard(IDLE);

    load(getRelationshipGraph({ scope, limit: 120 }), setGraph, controller, "Couldn't load the relationship graph.");
    load(
      getSimilarityLeaderboard({ scope, limit: 10 }),
      setLeaderboard,
      controller,
      "Couldn't load the similarity leaderboard."
    );

    return () => controller.abort();
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    setEntities(IDLE);

    load(
      getRepeatEntities({ entityType, minAppearances: 2 }),
      setEntities,
      controller,
      "Couldn't load repeat entities."
    );

    return () => controller.abort();
  }, [entityType]);

  return {
    scope,
    changeScope: useCallback((next) => setScope(next), []),
    entityType,
    changeEntityType: useCallback((next) => setEntityType(next), []),
    graph,
    leaderboard,
    entities,
  };
}

/** Resolves one request into its own slice of state, or records why it failed. */
function load(request, setState, controller, fallbackMessage) {
  request
    .then((data) => {
      if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
    })
    .catch((error) => {
      if (controller.signal.aborted) return;
      setState({ data: null, isLoading: false, error: error.message || fallbackMessage });
    });
}
