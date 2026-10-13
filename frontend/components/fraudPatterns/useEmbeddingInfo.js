"use client";

import { useEffect, useState } from "react";

import { getEmbeddingStatus } from "@/lib/api/embeddings";

/**
 * Which model will embed this collection, and how many dimensions it produces.
 *
 * Read from the API rather than hardcoded in the UI: the model is server
 * configuration (VOYAGE_MODEL), and a confirmation prompt that names the wrong
 * model is worse than one that names none. Returns nulls if the lookup fails,
 * and the prompt falls back to naming Voyage without a version.
 */
export default function useEmbeddingInfo(target, enabled = true) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    getEmbeddingStatus(target)
      .then((response) => {
        if (!cancelled) setInfo(response);
      })
      .catch(() => {
        // Non-fatal: the confirmation still works, just less specific.
        if (!cancelled) setInfo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [target, enabled]);

  return {
    model: info?.model || null,
    dimensions: info?.expectedDimensions || null,
    vectorIndexPresent: info?.vectorIndexPresent ?? null,
  };
}
