"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamAgentMessage, streamClaimAssessment, streamClaimDecision } from "@/lib/api/agentChat";
import { getClaim } from "@/lib/api/claims";
import { PROFILE } from "@/lib/const/nav";
import { getOrCreateUserId } from "@/lib/userIdentity";

/**
 * Runs one fraud assessment, then keeps the conversation open on the same
 * session so the reviewer can question the agent about the case and finally ask
 * it to commit their decision.
 *
 * The run starts on mount rather than behind a second click: the person already
 * pressed "Analyze for fraud", so making them confirm again would be a dead
 * step. Minimising the modal keeps this hook mounted, so the run carries on;
 * only discarding the assessment aborts what is streaming.
 *
 * `steps` accumulates every progress frame in order. `onProgress` only ever
 * carries the newest one, so without keeping the list the tool sequence the
 * agent followed — the interesting part of watching a run — would be lost as
 * each frame overwrote the last.
 *
 * SESSION ID — same three rules as useFraudChat, and they matter more here
 * because the decision is only meaningful on the conversation that produced the
 * analysis:
 *   1. Write-once. Every turn returns the `x-session-id` header; re-anchoring on
 *      each one risks drifting off the original conversation. Get it wrong and
 *      it still looks fine — replies keep arriving, the agent just no longer
 *      remembers the assessment.
 *   2. A ref, not state. Nothing renders it, and one arriving mid-stream must
 *      not re-render the transcript.
 *   3. Only accepted for the stream still in flight, so a late frame from an
 *      aborted run cannot overwrite it.
 */
export default function useAnalysisModal(claimId) {
  const [steps, setSteps] = useState([]);
  const [report, setReport] = useState("");
  const [phase, setPhase] = useState("running"); // running | complete | error
  const [error, setError] = useState(null);

  // Follow-up turns after the assessment, and the agent's closing confirmation.
  // The assessment report itself is not in here: it is the header of the
  // conversation, rendered above the transcript.
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const [decision, setDecision] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState(null);
  // What the claim document actually looks like after the agent says it wrote:
  // "verified" | "unknown", or null before a decision. A "not-recorded" check
  // surfaces as decisionError instead, with the form still open.
  const [persistence, setPersistence] = useState(null);

  /* Two abort refs, deliberately.
   *
   * `activeAbortRef` is whatever is streaming right now — what `stop()` cancels
   * and what the session-id guard checks identity against.
   *
   * `turnAbortRef` holds only a follow-up or decision turn. Unmount cleanup
   * aborts THAT one and never the assessment: under Strict Mode the mount effect
   * is invoked, cleaned up and invoked again, and aborting the assessment there
   * kills the only run the `startedForRef` guard then refuses to restart — the
   * modal hangs on "Starting the agent…" forever, because an AbortError is
   * swallowed as a user action and never moves `phase` off "running". The
   * assessment is cancelled explicitly instead, via `stop()`, which the modal
   * calls when it is closed or stopped.
   */
  const activeAbortRef = useRef(null);
  const turnAbortRef = useRef(null);
  const sessionIdRef = useRef(null);
  const isStreamingRef = useRef(false);
  // One run per claim, guarding against Strict Mode's double effect invocation
  // in dev — a second run would cost another 90 seconds of agent time.
  const startedForRef = useRef(null);

  const patchMessage = useCallback((id, patch) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) }
          : message
      )
    );
  }, []);

  const acceptSessionId = useCallback((sessionId, controller) => {
    if (!sessionIdRef.current && activeAbortRef.current === controller) {
      sessionIdRef.current = sessionId;
    }
  }, []);

  useEffect(() => {
    if (!claimId || startedForRef.current === claimId) return;
    startedForRef.current = claimId;

    const controller = new AbortController();
    activeAbortRef.current = controller;

    streamClaimAssessment(
      {
        claimId,
        userId: getOrCreateUserId(),
        triggeredBy: `analyst:${PROFILE.name}`,
        signal: controller.signal,
      },
      {
        // The handle the follow-up questions and the decision both ride on.
        onSessionId: (sessionId) => acceptSessionId(sessionId, controller),
        onProgress: (activity) => {
          // The platform emits empty progress frames between steps; they would
          // render as blank rows, so only labelled activity is kept.
          const label = typeof activity === "string" ? activity.trim() : "";
          if (!label) return;
          setSteps((current) =>
            // The agent repeats "Thinking..." between tool calls; collapsing
            // consecutive duplicates keeps the step list readable.
            current[current.length - 1] === label ? current : [...current, label]
          );
        },
        onText: (chunk) => setReport((current) => current + chunk),
        onDone: () => setPhase("complete"),
        onSuspend: () => setPhase("complete"),
        onStreamError: (reason) => {
          setError(reason);
          setPhase("error");
        },
      }
    ).catch((streamError) => {
      // The assessment is only ever aborted explicitly (Stop, or discarding it),
      // so an abort ends the run rather than leaving it "running" for good.
      setError(
        streamError.name === "AbortError"
          ? "You stopped the assessment before it finished. Nothing was recorded unless the agent had already reached assess_claim_fraud."
          : streamError.message || "The assessment could not be completed."
      );
      setPhase("error");
    });

    // Deliberately no cleanup abort. Under Strict Mode the effect is invoked,
    // cleaned up and invoked again; aborting here killed the only run the guard
    // above then refused to restart, so the modal sat empty and the proxy logged
    // a ResponseAborted. The stream is aborted explicitly instead — see `stop`,
    // which the modal calls when it is closed or stopped.
  }, [claimId, acceptSessionId]);

  /**
   * One conversational turn, and the closing decision turn, share this: both are
   * an agent stream appended to the transcript. `start` opens whichever stream
   * this turn needs, given the handlers.
   */
  const runTurn = useCallback(
    async (userContent, start) => {
      if (isStreamingRef.current) return null;

      // Random ids, not timestamps: a patch aimed at the reply must never be
      // able to land on the message that produced it.
      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        ...(userContent ? [{ id: crypto.randomUUID(), role: "user", content: userContent }] : []),
        { id: assistantId, role: "assistant", content: "", done: false, activity: null },
      ]);

      isStreamingRef.current = true;
      setIsStreaming(true);

      const controller = new AbortController();
      activeAbortRef.current = controller;
      turnAbortRef.current = controller;

      try {
        await start(controller, {
          onSessionId: (sessionId) => acceptSessionId(sessionId, controller),
          onText: (chunk) =>
            patchMessage(assistantId, (message) => ({
              content: message.content + chunk,
              activity: null,
            })),
          onProgress: (activity) => patchMessage(assistantId, { activity }),
          onSuspend: ({ reason, context }) =>
            patchMessage(assistantId, {
              done: true,
              activity: null,
              status: "suspended",
              suspendReason: reason,
              suspendContext: context,
            }),
          onDone: () => patchMessage(assistantId, { done: true, activity: null }),
          onStreamError: (reason) =>
            patchMessage(assistantId, { role: "error", content: reason, done: true }),
        });
        return assistantId;
      } catch (turnError) {
        if (turnError.name === "AbortError") {
          patchMessage(assistantId, (message) => ({
            done: true,
            activity: null,
            content: message.content || "Stopped.",
          }));
        } else {
          patchMessage(assistantId, {
            role: "error",
            content: turnError.message || "The agent could not be reached.",
            done: true,
          });
        }
        throw turnError;
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        activeAbortRef.current = null;
        turnAbortRef.current = null;
      }
    },
    [acceptSessionId, patchMessage]
  );

  /** A follow-up question about this case, on the assessment's conversation. */
  const sendMessage = useCallback(
    (rawText) => {
      const text = rawText.trim();
      if (!text) return;
      runTurn(text, (controller, handlers) =>
        streamAgentMessage(
          {
            message: text,
            sessionId: sessionIdRef.current,
            userId: getOrCreateUserId(),
            signal: controller.signal,
          },
          handlers
        )
      ).catch(() => {
        // Already rendered in the transcript by runTurn.
      });
    },
    [runTurn]
  );

  /**
   * Reads the claim back after the agent claims to have written it.
   *
   * The agent reporting success is not evidence that a write happened — it is a
   * language model describing its own actions. Since the audit trail and the
   * claim outcome are now the agent's responsibility, the one thing this UI can
   * still do honestly is check. Returns "verified" | "not-recorded" | "unknown".
   */
  const verifyPersisted = useCallback(async () => {
    try {
      // GET /claims/{id} returns the claim document flat (ClaimDetailResponse),
      // not wrapped in a `claim` key.
      const claim = (await getClaim(claimId)) || {};
      const fraud = claim.fraud || {};
      const recorded =
        fraud.reviewedAt != null && fraud.fraudFlag != null && claim.claimStatus === "CLOSED";
      return recorded ? "verified" : "not-recorded";
    } catch {
      // Could not check — reported as unknown rather than as either outcome.
      return "unknown";
    }
  }, [claimId]);

  /**
   * Sends the reviewer's verdict to the agent to record, on the assessment's
   * session when there is one. The agent is the only writer of fraud state, so
   * the claim is read back afterwards to see whether the write actually landed.
   */
  const recordDecision = useCallback(
    async ({ decision: verdict, dismissReason, siuReferred }) => {
      setIsSubmitting(true);
      setDecisionError(null);
      setPersistence(null);

      try {
        await runTurn(
          verdict === "CONFIRMED_FRAUD"
            ? "Confirm this claim as fraud and close the case."
            : "Dismiss this claim and close the case.",
          (controller, handlers) =>
            streamClaimDecision(
              {
                claimId,
                sessionId: sessionIdRef.current || undefined,
                decision: verdict,
                dismissReason,
                siuReferred,
                reviewedBy: PROFILE.name,
                userId: getOrCreateUserId(),
                signal: controller.signal,
              },
              handlers
            )
        );
        const persisted = await verifyPersisted();
        if (persisted === "not-recorded") {
          // The decision form stays open so the reviewer can try again.
          setDecisionError(
            "The decision did not reach the claim record (it is not marked as decided and closed). Check the agent's reply above and record the decision again."
          );
          return;
        }
        setPersistence(persisted);
        setDecision({
          state: verdict === "CONFIRMED_FRAUD" ? "confirmed" : "dismissed",
          siuReferred,
        });
      } catch (submitError) {
        setDecisionError(submitError.message || "Could not send the decision to the agent.");
        throw submitError;
      } finally {
        setIsSubmitting(false);
      }
    },
    [claimId, runTurn, verifyPersisted]
  );

  const stop = useCallback(() => activeAbortRef.current?.abort(), []);

  /* A turn outliving the component would keep patching unmounted state. Only
     turns: see the note on the two refs above for why the assessment must
     survive Strict Mode's simulated unmount. */
  useEffect(() => () => turnAbortRef.current?.abort(), []);

  return {
    steps,
    report,
    phase,
    error,
    messages,
    isStreaming,
    sendMessage,
    decision,
    isSubmitting,
    decisionError,
    persistence,
    recordDecision,
    stop,
    hasSession: Boolean(sessionIdRef.current),
    sessionId: sessionIdRef.current,
  };
}
