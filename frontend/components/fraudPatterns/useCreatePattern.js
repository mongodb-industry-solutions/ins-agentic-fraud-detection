"use client";

import { useState } from "react";

import { createFraudPattern } from "@/lib/api/fraudPatterns";

/**
 * The submit half of both add-forms: in-flight state, the request, and the
 * server's refusal if it comes. Shared so a rule and a similarity pattern
 * cannot drift into reporting failures differently.
 */
export default function useCreatePattern(onCreated) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const submit = async (payload) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await createFraudPattern(payload);
      onCreated(response.pattern, response);
    } catch (writeError) {
      setSaveError(writeError.message);
    } finally {
      setIsSaving(false);
    }
  };

  return { submit, isSaving, saveError };
}
