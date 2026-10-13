"use client";

import { useState } from "react";

import { embedDocument } from "@/lib/api/embeddings";
import { createFraudPattern } from "@/lib/api/fraudPatterns";

/**
 * The submit half of both add-forms: in-flight state, the request, and the
 * server's refusal if it comes. Shared so a rule and a similarity pattern
 * cannot drift into reporting failures differently.
 *
 * With `embedAfterCreate`, a successful create is followed by embedding the new
 * pattern's narrative. The two stay separate calls rather than one endpoint
 * doing both, because they fail differently and only one of them is
 * recoverable: a created-but-unembedded pattern is a valid pattern in the
 * "pending embedding" state the UI already renders, whereas rolling back the
 * creation because Voyage was briefly down would throw away the user's work.
 */
export default function useCreatePattern(onCreated, { embedAfterCreate = false } = {}) {
  const [isSaving, setIsSaving] = useState(false);
  const [phase, setPhase] = useState(null); // "creating" | "embedding"
  const [saveError, setSaveError] = useState(null);

  const submit = async (payload) => {
    setIsSaving(true);
    setSaveError(null);
    setPhase("creating");

    let response;
    try {
      response = await createFraudPattern(payload);
    } catch (writeError) {
      setSaveError(writeError.message);
      setIsSaving(false);
      setPhase(null);
      return;
    }

    let embedding = null;
    if (embedAfterCreate) {
      setPhase("embedding");
      try {
        embedding = await embedDocument("fraud_patterns", response.patternId);
      } catch (embedError) {
        // Reported through onCreated, NOT as saveError: the pattern exists, and
        // telling someone their save failed when it did not is worse than
        // telling them the embedding still has to happen.
        embedding = { embedded: false, error: embedError.message };
      }
    }

    setIsSaving(false);
    setPhase(null);
    onCreated(response.pattern, response, embedding);
  };

  return { submit, isSaving, phase, saveError };
}
