"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import ChatMessage from "@/components/fraudChat/ChatMessage";
import Icon from "@/components/icons/Icons";
import styles from "./AnalysisModal.module.css";
import useAnalysisModal from "./useAnalysisModal";

/* The agent's report is markdown with tables and headings, and Tailwind's
   preflight strips list markers and heading margins, so every block it can emit
   needs an explicit class. */
const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className={styles.mdParagraph}>{children}</p>,
  h1: ({ children }) => <h4 className={styles.mdHeading}>{children}</h4>,
  h2: ({ children }) => <h4 className={styles.mdHeading}>{children}</h4>,
  h3: ({ children }) => <h5 className={styles.mdSubheading}>{children}</h5>,
  h4: ({ children }) => <h5 className={styles.mdSubheading}>{children}</h5>,
  ul: ({ children }) => <ul className={styles.mdList}>{children}</ul>,
  ol: ({ children }) => <ol className={styles.mdList}>{children}</ol>,
  li: ({ children }) => <li className={styles.mdListItem}>{children}</li>,
  strong: ({ children }) => <strong className={styles.mdStrong}>{children}</strong>,
  code: ({ children }) => <code className={styles.mdCode}>{children}</code>,
  pre: ({ children }) => <pre className={styles.mdPre}>{children}</pre>,
  blockquote: ({ children }) => <blockquote className={styles.mdQuote}>{children}</blockquote>,
  hr: () => <hr className={styles.mdRule} />,
  table: ({ children }) => (
    <div className={styles.mdTableWrap}>
      <table className={styles.mdTable}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={styles.mdTh}>{children}</th>,
  td: ({ children }) => <td className={styles.mdTd}>{children}</td>,
};

function StepList({ steps, isRunning }) {
  if (!steps.length) return null;

  return (
    <div className={styles.steps}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isActive = isRunning && isLast;
        return (
          <div key={`${index}-${step}`} className={styles.step}>
            <span className={isActive ? styles.stepSpinner : styles.stepDot}>
              {!isActive && <Icon name="check" size={9} />}
            </span>
            <span className={isActive ? styles.stepTextActive : styles.stepText}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Closing the case: the verdict, the reason, and the hand-off to the agent.
 *
 * The reason is required for BOTH outcomes, not just a dismissal. It is no
 * longer only a field on the claim — it is what the agent writes into the audit
 * trail as the human's rationale, and "confirmed as fraud, no reason given" is a
 * worse audit record than a dismissal without one.
 */
function CloseCaseBar({
  decision,
  persistence,
  isSubmitting,
  isStreaming,
  error,
  hasSession,
  onDecide,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [verdict, setVerdict] = useState(null); // CONFIRMED_FRAUD | DISMISSED
  const [siuChecked, setSiuChecked] = useState(false);
  const [reason, setReason] = useState("");

  // A recorded decision and the controls are mutually exclusive: the modal must
  // not offer to decide again. What is shown is the verification result, because
  // the agent saying it wrote is not the same as the claim having changed.
  if (decision) {
    return (
      <div className={styles.decisionArea}>
        <div className={styles.decisionMade}>
          <Icon name="check" size={12} />
          {decision.state === "confirmed"
            ? `Confirmed as fraud${decision.siuReferred ? " · referred to SIU" : ""}`
            : "Dismissed"}
        </div>

        {persistence === "verified" && (
          <span className={styles.persistenceOk}>
            <Icon name="check" size={11} />
            Verified on the claim record
          </span>
        )}
        {persistence === "not-recorded" && (
          <span className={styles.persistenceWarn}>
            <Icon name="alert" size={11} />
            The agent reported success, but the claim still shows no decision — nothing was
            persisted.
          </span>
        )}
        {persistence === "unknown" && (
          <span className={styles.persistenceWarn}>
            <Icon name="alert" size={11} />
            Could not read the claim back to confirm what was written.
          </span>
        )}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <div className={styles.decisionArea}>
        <button
          type="button"
          className={styles.closeCaseTrigger}
          disabled={isStreaming}
          onClick={() => setIsOpen(true)}
        >
          Close case — record a decision
        </button>
        {error && <div className={styles.decisionError}>{error}</div>}
      </div>
    );
  }

  const canSubmit = Boolean(verdict) && reason.trim().length > 0 && !isSubmitting && !isStreaming;

  return (
    <div className={styles.decisionArea}>
      <div className={styles.verdictRow}>
        <span className={styles.verdictLabel}>Outcome</span>
        <button
          type="button"
          className={`${styles.verdictOption} ${
            verdict === "CONFIRMED_FRAUD" ? styles.verdictOptionActive : ""
          }`}
          onClick={() => setVerdict("CONFIRMED_FRAUD")}
        >
          Fraud
        </button>
        <button
          type="button"
          className={`${styles.verdictOption} ${
            verdict === "DISMISSED" ? styles.verdictOptionActive : ""
          }`}
          onClick={() => setVerdict("DISMISSED")}
        >
          Not fraud
        </button>
        {verdict === "CONFIRMED_FRAUD" && (
          <label className={styles.siuRow}>
            <input
              type="checkbox"
              checked={siuChecked}
              onChange={(event) => setSiuChecked(event.target.checked)}
            />
            Also refer to SIU
          </label>
        )}
      </div>

      <div className={styles.dismissForm}>
        <textarea
          className={styles.textarea}
          placeholder="Reason for this decision (required) — the agent records this in the audit trail"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className={styles.btnConfirm}
          disabled={!canSubmit}
          onClick={() =>
            onDecide({
              decision: verdict,
              dismissReason: reason.trim(),
              siuReferred: verdict === "CONFIRMED_FRAUD" ? siuChecked : false,
            })
          }
        >
          {isSubmitting ? "Sending to the agent…" : "Send to agent and close"}
        </button>
      </div>

      {/* Said before the hand-off, not after: the reviewer is asking something
          that may not do it, so what is expected to happen is stated up front. */}
      <div className={styles.commitNote}>
        The agent records the decision on the claim, writes the audit-trail entry for this review
        and closes the case, on the same conversation as the analysis above. The claim is read back
        afterwards to confirm what actually landed.
        {!hasSession &&
          " No agent session was captured for this run, so the decision cannot be handed over — re-run the analysis."}
      </div>

      {error && <div className={styles.decisionError}>{error}</div>}
    </div>
  );
}

/**
 * The live fraud-analysis overlay: streams the agent's run, then shows its
 * report and the confirm/dismiss decision.
 *
 * The report is the agent's markdown prose. Once the agent emits a structured
 * payload, `FraudReportContent` replaces the markdown block here and nothing
 * else in this shell changes.
 */
export default function AnalysisModal({ claimId, onClose, onDecided }) {
  const analysis = useAnalysisModal(claimId);
  const isRunning = analysis.phase === "running";

  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    analysis.sendMessage(text);
  };

  const onComposerKeyDown = (event) => {
    // Enter sends, Shift+Enter is a newline — same contract as the fraud chat,
    // so muscle memory carries between the two.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendDraft();
    }
  };

  // The browser blurs a disabled element, so focus is restored when a turn ends
  // rather than only when the composer first appears.
  useEffect(() => {
    if (!isRunning && !analysis.isStreaming) inputRef.current?.focus();
  }, [isRunning, analysis.isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [analysis.messages]);

  // Closing is the only thing that aborts the stream. The hook deliberately does
  // not abort on effect cleanup, because Strict Mode's double invocation would
  // then kill the run before it produced anything.
  const close = useCallback(() => {
    analysis.stop();
    onClose();
  }, [analysis, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  const decide = async (payload) => {
    try {
      await analysis.recordDecision(payload);
    } catch {
      // Already surfaced in the transcript and on the decision bar; the refetch
      // below still runs, because a failed *stream* does not prove the agent
      // wrote nothing.
    }
    // Lets the claim view refetch, so its status pill stops disagreeing with
    // whatever the agent committed.
    onDecided?.();
  };

  return (
    <>
      {/* No click-to-close while the agent is mid-run: a stray click on the
          backdrop would silently discard a 90-second assessment. */}
      <div className={styles.backdrop} onClick={isRunning ? undefined : close} />
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`Fraud analysis for ${claimId}`}
      >
        <div className={styles.header}>
          <div>
            <div className={styles.title}>
              Fraud analysis <span className={styles.claimId}>{claimId}</span>
            </div>
            <div className={styles.sub}>
              {isRunning
                ? "The agent is working through the claim…"
                : analysis.phase === "error"
                  ? "The analysis did not finish"
                  : "Assessment complete — recorded once you decide"}
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.scroll}>
          <StepList steps={analysis.steps} isRunning={isRunning} />

          {isRunning && !analysis.steps.length && (
            <div className={styles.step}>
              <span className={styles.stepSpinner} />
              <span className={styles.stepTextActive}>Starting the agent…</span>
            </div>
          )}

          {analysis.phase === "error" && (
            <div className={styles.errorNote}>
              <Icon name="alert" size={13} /> {analysis.error}
            </div>
          )}

          {analysis.report && (
            <div className={styles.report}>
              {/* Markdown renders only once the stream is done: reparsing the
                  whole accumulated string per token saturates the main thread
                  on a report this long. */}
              {isRunning ? (
                <span className={styles.streamingText}>{analysis.report}</span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {analysis.report}
                </ReactMarkdown>
              )}
            </div>
          )}

          {/* The report is the first turn of a conversation, so the follow-up
              transcript continues in the same scroll area rather than in a
              separate panel. Turns use the same ChatMessage component as the
              fraud chat, so a reply reads identically in both places. */}
          {!isRunning && analysis.phase !== "error" && (
            <>
              <div className={styles.conversationDivider}>Conversation</div>
              {analysis.messages.length === 0 && (
                <div className={styles.conversationHint}>
                  Anything else you&apos;d like to know about this case? Ask below — the agent still
                  has this assessment in context.
                </div>
              )}
              {analysis.messages.map((message) => (
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

        {/* Composer only once the assessment is done: there is nothing to ask
            about mid-run, and a second concurrent turn on the same session would
            interleave with the assessment still streaming. */}
        {!isRunning && analysis.phase !== "error" && (
          <div className={styles.composer}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                analysis.isStreaming
                  ? "The agent is answering…"
                  : "Anything else you'd like to know about this case?"
              }
              rows={2}
              disabled={analysis.isStreaming}
            />
            <div className={styles.composerFooter}>
              <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
              {analysis.isStreaming ? (
                <button type="button" className={styles.stopButton} onClick={analysis.stop}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.sendButton}
                  disabled={!draft.trim()}
                  onClick={sendDraft}
                >
                  Send
                </button>
              )}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          {isRunning ? (
            <>
              <span className={styles.runningNote}>
                <span className={styles.stepSpinner} /> Analysing — this usually takes under two
                minutes.
              </span>
              <span className={styles.footerSpacer} />
              <button type="button" className={styles.btnOutline} onClick={analysis.stop}>
                Stop
              </button>
            </>
          ) : (
            <CloseCaseBar
              decision={analysis.decision}
              persistence={analysis.persistence}
              isSubmitting={analysis.isSubmitting}
              isStreaming={analysis.isStreaming}
              error={analysis.decisionError}
              hasSession={analysis.hasSession}
              onDecide={decide}
            />
          )}
        </div>
      </div>
    </>
  );
}
