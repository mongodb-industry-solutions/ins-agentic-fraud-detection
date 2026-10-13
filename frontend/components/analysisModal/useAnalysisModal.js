"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getAssessmentJob, recordAssessmentDecision } from "@/lib/api/assessmentQueue";
import { streamAgentMessage } from "@/lib/api/agentChat";
import { PROFILE } from "@/lib/const/nav";
import { getOrCreateUserId } from "@/lib/userIdentity";

// How often the window re-reads its job while the agent is working.
const JOB_POLL_MS = 1500;

/** Queue job status -> what the window is showing. */
function toPhase(status) {
  if (status === "WAITING") return "waiting";
  if (status === "PROCESSING") return "running";
  if (status === "READY_FOR_REVIEW" || status === "DECIDED") return "complete";
  if (status === "FAILED" || status === "CANCELLED") return "error";
  return "loading";
}

/**
 * One assessment window, for one job in the Fraud Assessment Queue.
 *
 * The assessment itself runs in the backend's queue worker, not here: this hook
 * reads the job (its steps, report and agent session) and re-reads it while the
 * agent is working. Closing the window therefore never affects the run.
 *
 * Follow-up questions and the decision are still live agent turns, streamed
 * on the job's own session, so the agent has its assessment in context.
 */
export default function useAnalysisModal(jobId, claimId) {
  const [job, setJob] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Follow-up turns after the assessment, and the agent's closing confirmation.
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // The decision is recorded by the backend (see recordDecision); only the
  // request itself and an error sending it are local.
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const activeAbortRef = useRef(null);
  const isStreamingRef = useRef(false);

  const phase = job ? toPhase(job.status) : loadError ? "error" : "loading";
  const isRecordingDecision = job?.decisionStatus === "RECORDING";
  // Keep re-reading the job while the agent works on it: the assessment, or
  // the decision being recorded.
  const isWorking =
    phase === "loading" || phase === "waiting" || phase === "running" || isRecordingDecision;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getAssessmentJob(jobId);
        if (!cancelled) {
          setJob(next);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error.message || "Could not load this assessment.");
      }
    };
    load();
    if (!isWorking) return () => { cancelled = true; };
    const timer = setInterval(load, JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, isWorking]);

  const sessionId = job?.sessionId || null;

  const patchMessage = useCallback((id, patch) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) }
          : message
      )
    );
  }, []);

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

      try {
        await start(controller, {
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
      }
    },
    [patchMessage]
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
            sessionId,
            userId: getOrCreateUserId(),
            signal: controller.signal,
          },
          handlers
        )
      ).catch(() => {
        // Already rendered in the transcript by runTurn.
      });
    },
    [runTurn, sessionId]
  );

  /**
   * Hands the reviewer's decision to the backend. It returns at once: the agent
   * records the decision in the background, on this job's session, and the
   * backend reads the claim back before marking the job decided. The window can
   * therefore be closed straight away without losing the decision.
   */
  const recordDecision = useCallback(
    async ({ decision: verdict, dismissReason, siuReferred }) => {
      setIsSending(true);
      setSendError(null);
      try {
        await recordAssessmentDecision(jobId, {
          decision: verdict,
          reviewedBy: PROFILE.name,
          reason: dismissReason,
          siuReferred,
        });
        // Picks up decisionStatus=RECORDING now, so polling resumes at once.
        setJob(await getAssessmentJob(jobId));
      } catch (error) {
        setSendError(error.message || "Could not send the decision to the agent.");
      } finally {
        setIsSending(false);
      }
    },
    [jobId]
  );

  /** Stops a follow-up answer; the assessment itself is stopped via the queue. */
  const stopTurn = useCallback(() => activeAbortRef.current?.abort(), []);

  useEffect(() => () => activeAbortRef.current?.abort(), []);

  // The decision turn, rebuilt from the job so it survives closing the window.
  const request = job?.decisionRequest;
  const decisionTurn = request
    ? [
        {
          id: "decision-request",
          role: "user",
          content:
            request.decision === "CONFIRMED_FRAUD"
              ? "Confirm this claim as fraud and close the case."
              : "Dismiss this claim and close the case.",
        },
        {
          id: "decision-reply",
          role: "assistant",
          content: job.decisionReply || "",
          done: !isRecordingDecision,
          activity: isRecordingDecision ? "Recording your decision…" : null,
        },
      ]
    : [];

  const isDecided = job?.status === "DECIDED";

  return {
    job,
    steps: job?.steps || [],
    report: job?.report || "",
    phase,
    error: loadError || job?.error || null,
    messages: [...messages, ...decisionTurn],
    isStreaming,
    sendMessage,
    decision: isDecided
      ? {
          state:
            request?.decision === "CONFIRMED_FRAUD"
              ? "confirmed"
              : request?.decision === "DISMISSED"
                ? "dismissed"
                : "recorded",
          siuReferred: Boolean(request?.siuReferred),
        }
      : null,
    isDecided,
    isRecordingDecision,
    isSubmitting: isSending || isRecordingDecision,
    decisionError: sendError || (job?.decisionStatus === "FAILED" ? job.decisionError : null),
    // Set only once the backend has read the decision back off the claim.
    persistence: isDecided ? "verified" : null,
    recordDecision,
    stopTurn,
  };
}
