"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamClaimAssessment } from "@/lib/api/agentChat";
import { submitFraudDecision } from "@/lib/api/claims";
import { PROFILE } from "@/lib/const/nav";
import { getOrCreateUserId } from "@/lib/userIdentity";

/**
 * Runs one fraud assessment and holds everything the modal renders.
 *
 * The run starts on mount rather than behind a second click: the person already
 * pressed "Analyze for fraud", so making them confirm again would be a dead
 * step. Closing the modal aborts the stream.
 *
 * `steps` accumulates every progress frame in order. `onProgress` only ever
 * carries the newest one, so without keeping the list the tool sequence the
 * agent followed — which is the interesting part of watching a run — would be
 * lost as each frame overwrote the last.
 */
export default function useAnalysisModal(claimId) {
  const [steps, setSteps] = useState([]);
  const [report, setReport] = useState("");
  const [phase, setPhase] = useState("running"); // running | complete | error
  const [error, setError] = useState(null);

  const [decision, setDecision] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState(null);

  const abortRef = useRef(null);
  const sessionIdRef = useRef(null);
  // One run per claim, guarding against Strict Mode's double effect invocation
  // in dev — a second run would cost another 90 seconds of agent time.
  const startedForRef = useRef(null);

  useEffect(() => {
    if (!claimId || startedForRef.current === claimId) return;
    startedForRef.current = claimId;

    const controller = new AbortController();
    abortRef.current = controller;

    streamClaimAssessment(
      { claimId, userId: getOrCreateUserId(), signal: controller.signal },
      {
        // Kept so a follow-up question can join the same conversation as the
        // assessment the reviewer just watched.
        onSessionId: (sessionId) => {
          if (!sessionIdRef.current) sessionIdRef.current = sessionId;
        },
        onProgress: (activity) =>
          setSteps((current) =>
            // The agent repeats "Thinking..." between tool calls; collapsing
            // consecutive duplicates keeps the step list readable.
            current[current.length - 1] === activity ? current : [...current, activity]
          ),
        onText: (chunk) => setReport((current) => current + chunk),
        onDone: () => setPhase("complete"),
        onSuspend: () => setPhase("complete"),
        onStreamError: (reason) => {
          setError(reason);
          setPhase("error");
        },
      }
    ).catch((streamError) => {
      // Aborting is the reviewer closing the modal, not a failure.
      if (streamError.name === "AbortError") return;
      setError(streamError.message || "The assessment could not be completed.");
      setPhase("error");
    });

    // Deliberately no cleanup abort. Under Strict Mode the effect is invoked,
    // cleaned up and invoked again; aborting here killed the only run the guard
    // above then refused to restart, so the modal sat empty and the proxy logged
    // a ResponseAborted. The stream is aborted explicitly instead — see `stop`,
    // which the modal calls when it is closed or stopped.
  }, [claimId]);

  /**
   * Records the reviewer's decision. This does not go to the agent: the
   * assessment is a recommendation, and this endpoint is what commits it and
   * recalculates the pattern reliability stats.
   */
  const recordDecision = useCallback(
    async ({ decision: verdict, dismissReason, siuReferred }) => {
      setIsSubmitting(true);
      setDecisionError(null);
      try {
        await submitFraudDecision(claimId, {
          decision: verdict,
          reviewedBy: PROFILE.name,
          dismissReason,
          siuReferred,
        });
        setDecision({ state: verdict === "CONFIRMED_FRAUD" ? "confirmed" : "dismissed", siuReferred });
      } catch (submitError) {
        setDecisionError(submitError.message || "Could not record the decision.");
        throw submitError;
      } finally {
        setIsSubmitting(false);
      }
    },
    [claimId]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    steps,
    report,
    phase,
    error,
    decision,
    isSubmitting,
    decisionError,
    recordDecision,
    stop,
    sessionId: sessionIdRef.current,
  };
}
