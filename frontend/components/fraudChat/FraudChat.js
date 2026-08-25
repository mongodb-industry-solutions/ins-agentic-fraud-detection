"use client";

import { useEffect, useRef, useState } from "react";

import Icon from "@/components/icons/Icons";
import ChatMessage from "./ChatMessage";
import styles from "./FraudChat.module.css";
import useFraudChat from "./useFraudChat";

const SUGGESTED_PROMPTS = [
  "Which open claims carry the highest fraud risk right now?",
  "Assess claim CLM-1001 for fraud and explain the score.",
  "What fraud patterns are driving flagged claims this quarter?",
  "Summarise the fraud exposure across the policy portfolio.",
];

export default function FraudChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, isStreaming, sendMessage, stopStreaming, resetSession } = useFraudChat();

  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    // The app behind the blur must not scroll under the modal.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // The textarea is disabled while the agent answers, and the browser blurs a
  // disabled element — so focus is restored when the stream ends, not only on open.
  useEffect(() => {
    if (isOpen && !isStreaming) inputRef.current?.focus();
  }, [isOpen, isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = (text) => {
    setDraft("");
    sendMessage(text);
  };

  const onKeyDown = (event) => {
    // Enter sends; Shift+Enter is a newline, since answers are often follow-ups
    // to a multi-line claim description pasted in.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim() && !isStreaming) submit(draft);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setIsOpen(true)}
        aria-label="Ask the fraud assessment agent"
      >
        <Icon name="sparkle" size={18} />
        <span>Ask the fraud agent</span>
      </button>
    );
  }

  return (
    <>
      <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Fraud assessment agent"
      >
        <div className={styles.header}>
          <div className={styles.headerMain}>
            <span className={styles.title}>Fraud assessment agent</span>
            <span className={styles.subline}>
              Claims, policies, customers and portfolio-level fraud analysis
            </span>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              className={styles.headerButton}
              onClick={resetSession}
              title="Forget this conversation and start a new one"
            >
              New chat
            </button>
          )}
          <button
            type="button"
            className={styles.close}
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.scroll}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>
                Ask about a claim, a customer, or the whole portfolio
              </span>
              <span className={styles.emptyBody}>
                The agent scores claims for fraud, explains which patterns matched, and can compare
                a claim against similar historical ones.
              </span>
              <div className={styles.prompts}>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className={styles.prompt}
                    onClick={() => submit(prompt)}
                  >
                    <Icon name="sparkle" size={13} />
                    <span className={styles.promptText}>{prompt}</span>
                    <span className={styles.promptArrow}>→</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  done={message.done}
                  activity={message.activity}
                  status={message.status}
                  suspendContext={message.suspendContext}
                />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className={styles.composer}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isStreaming ? "The agent is answering…" : "Ask about claims, policies or fraud risk…"
            }
            rows={2}
            disabled={isStreaming}
          />
          <div className={styles.composerFooter}>
            <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
            {isStreaming ? (
              <button type="button" className={styles.stopButton} onClick={stopStreaming}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                disabled={!draft.trim()}
                onClick={() => submit(draft)}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
