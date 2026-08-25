"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamAgentMessage } from "@/lib/api/agentChat";
import { getOrCreateUserId } from "@/lib/userIdentity";

/**
 * Owns one conversation with the fraud assessment agent: the message feed, the
 * in-flight stream and the session id.
 *
 * The session id is the value Magenta returns in the `x-session-id` response
 * header on the first turn. Sending it back on later turns is what makes the
 * engine load that conversation's checkpoint. The `execution_id` in the response
 * body is *not* this: it identifies one run, and using it as the conversation
 * key opens a brand-new conversation on every turn.
 *
 * Three things here are load-bearing:
 *
 * 1. **Write-once.** Every turn returns the header, and re-anchoring on each
 *    one risks drifting off the original conversation. Get this wrong and it
 *    still *looks* like it works — replies keep arriving and the transcript
 *    keeps growing, the agent just has no memory of earlier turns.
 * 2. **A ref, not state.** Nothing renders the id, and one arriving mid-stream
 *    must not re-render the transcript. The consequence is deliberate: memory
 *    does not survive a page reload.
 * 3. **Reset aborts first.** Otherwise a still-running stream's late `done`
 *    frame writes its id into the conversation you just ended, reviving it.
 */
export default function useFraudChat() {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Null until the first reply comes back; see this hook's doc comment.
  const sessionIdRef = useRef(null);
  const abortRef = useRef(null);
  // Mirrors `isStreaming` so `sendMessage` can reject a concurrent send without
  // taking the state as a dependency, which would make it a new function on
  // every streamed token.
  const isStreamingRef = useRef(false);

  const patchMessage = useCallback((id, patch) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) }
          : message
      )
    );
  }, []);

  const sendMessage = useCallback(
    async (rawText) => {
      const text = rawText.trim();
      if (!text || isStreamingRef.current) return;

      // Random ids, not timestamps: a patch aimed at the assistant reply must
      // never be able to land on the question that produced it.
      const userMessage = { id: crypto.randomUUID(), role: "user", content: text };
      const assistantId = crypto.randomUUID();
      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        done: false,
        activity: null,
      };

      setMessages((current) => [...current, userMessage, assistantMessage]);
      isStreamingRef.current = true;
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamAgentMessage(
          {
            message: text,
            sessionId: sessionIdRef.current,
            userId: getOrCreateUserId(),
            signal: controller.signal,
          },
          {
            onSessionId: (sessionId) => {
              // Write-once, and only for the stream still in flight: a header
              // arriving after the user hit "New chat" belongs to a conversation
              // that no longer exists and must not revive it.
              if (!sessionIdRef.current && abortRef.current === controller) {
                sessionIdRef.current = sessionId;
              }
            },
            // `activity` is cleared the moment real content starts, so the tool
            // status line does not linger underneath the answer.
            onText: (chunk) =>
              patchMessage(assistantId, (message) => ({
                content: message.content + chunk,
                activity: null,
              })),
            onProgress: (activity) => patchMessage(assistantId, { activity }),
            // `executionId` is threaded through explicitly and stored on the
            // message itself: resuming a suspended run needs *this turn's*
            // execution id, which is only the same as the session id on turn 1.
            // Reading it back out of `sessionIdRef` would work until turn 2 and
            // then resume the wrong execution.
            onSuspend: ({ reason, context, executionId }) =>
              patchMessage(assistantId, {
                done: true,
                activity: null,
                status: "suspended",
                suspendReason: reason,
                suspendContext: context,
                executionId,
              }),
            onDone: () => patchMessage(assistantId, { done: true, activity: null }),
            onStreamError: (reason) =>
              patchMessage(assistantId, { role: "error", content: reason, done: true }),
          }
        );
      } catch (error) {
        // Aborting is a user action, not a failure: no error bubble, just the
        // partial answer with a note.
        if (error.name === "AbortError") {
          patchMessage(assistantId, (message) => ({
            done: true,
            activity: null,
            content: message.content || "Stopped.",
          }));
        } else {
          patchMessage(assistantId, {
            role: "error",
            content: error.message || "The agent could not be reached.",
            done: true,
          });
        }
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [patchMessage]
  );

  const stopStreaming = useCallback(() => abortRef.current?.abort(), []);

  /**
   * Starts a fresh conversation: a new session id is minted on the next send,
   * so the agent begins with no memory of what came before.
   *
   * The transcript is cleared along with the id because this panel shows exactly
   * one conversation — leaving turns on screen that the agent can no longer
   * recall would misrepresent what it is able to refer back to.
   */
  const resetSession = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = null;
    setMessages([]);
  }, []);

  // A stream outliving the component would keep patching unmounted state.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, isStreaming, sendMessage, stopStreaming, resetSession };
}
