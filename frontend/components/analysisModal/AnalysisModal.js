"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import ChatMessage from "@/components/fraudChat/ChatMessage";
import Icon from "@/components/icons/Icons";
import useThrottledText from "@/lib/useThrottledText";
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
  isOpen,
  onOpen,
  onCancel,
  onDecide,
}) {
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
            : decision.state === "dismissed"
              ? "Dismissed"
              : "Decision recorded"}
        </div>

        {persistence === "verified" && (
          <span className={styles.persistenceOk}>
            <Icon name="check" size={11} />
            Verified on the claim record · claim closed
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
        {/* The obvious next step once the report is in, so it is the one filled
            button in the footer. */}
        <button
          type="button"
          className={styles.closeCaseTrigger}
          disabled={isStreaming}
          onClick={onOpen}
        >
          <Icon name="checkCircle" size={14} />
          Record your decision
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
        <button
          type="button"
          className={styles.cancelDecision}
          disabled={isSubmitting}
          onClick={onCancel}
        >
          Back to the conversation
        </button>
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
        The agent records your decision and reason on the claim, merges them into this
        assessment&apos;s audit trail and closes the claim. The claim is read back afterwards to
        confirm what actually landed.
      </div>

      {error && <div className={styles.decisionError}>{error}</div>}
    </div>
  );
}

/**
 * The assessment window for one job in the Fraud Assessment Queue.
 *
 * The run itself belongs to the backend's queue worker, so this window can be
 * closed at any time — "Come back later" — and reopened from the queue panel
 * with everything the agent has produced so far. Follow-up questions and the
 * decision are live agent turns on the job's own session.
 */
export default function AnalysisModal({ jobId, claimId, onClose, onDecided }) {
  const analysis = useAnalysisModal(jobId, claimId);
  const isRunning = analysis.phase === "running";
  const isWaiting = analysis.phase === "waiting" || analysis.phase === "loading";
  const isWorking = isRunning || isWaiting;

  const [draft, setDraft] = useState("");
  // The decision form replaces the composer while it is open, so the footer
  // shows one task at a time.
  const [isDeciding, setIsDeciding] = useState(false);
  const [isActivityCollapsed, setIsActivityCollapsed] = useState(false);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  // Lets the report render as markdown while it updates without re-parsing on
  // every change; flushed exactly once the run finishes.
  const streamedReport = useThrottledText(analysis.report, { immediate: !isRunning });

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
    if (!isWorking && !analysis.isStreaming && !isDeciding) inputRef.current?.focus();
  }, [isWorking, analysis.isStreaming, isDeciding]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [analysis.messages]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const decide = (payload) => analysis.recordDecision(payload);

  // Once the backend confirms the decision is on the claim, hand over so the
  // window can move on to the next claim. Fires once per job, and only while
  // the window is open — closed, the queue panel and a notification take over.
  const announcedRef = useRef(false);
  useEffect(() => {
    if (analysis.isDecided && !announcedRef.current && analysis.job?.decisionRequest) {
      announcedRef.current = true;
      onDecided?.(jobId);
    }
  }, [analysis.isDecided, analysis.job, jobId, onDecided]);

  // A recorded decision ends the decision task, so the form closes with it.
  useEffect(() => {
    if (analysis.decision) setIsDeciding(false);
  }, [analysis.decision]);

  const showConversation = analysis.phase === "complete";

  return (
    <>
      {/* Clicking outside closes the window; the assessment carries on in the
          queue and is reopened from the panel. */}
      <div className={styles.backdrop} onClick={onClose} />
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
                ? "The agent is working through the claim"
                : isWaiting
                  ? "Waiting to be processed — the agent is finishing the claim ahead of it"
                  : analysis.phase === "error"
                    ? "The analysis did not finish"
                    : analysis.decision
                      ? "Decision recorded"
                      : analysis.isRecordingDecision
                        ? "Recording your decision — you can close this window"
                        : "Assessment complete and recorded — awaiting your decision"}
            </div>
          </div>
          {analysis.decision ? (
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          ) : (
            <button
              type="button"
              className={styles.laterBtn}
              onClick={onClose}
              title="Close this window — reopen it any time from the Fraud Assessment Queue"
            >
              Come back later
            </button>
          )}
        </div>

        <div className={styles.body}>
          <div className={styles.main}>
            <div className={styles.scroll}>
              {analysis.phase === "error" && (
                <div className={styles.errorNote}>
                  <Icon name="alert" size={13} /> {analysis.error}
                </div>
              )}

              {analysis.report && (
                <div className={styles.report}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                    {streamedReport}
                  </ReactMarkdown>
                </div>
              )}

              {/* The report is the first turn of a conversation, so the follow-up
                  transcript continues in the same scroll area. Turns use the same
                  ChatMessage component as the fraud chat. */}
              {showConversation && (
                <>
                  {(analysis.messages.length > 0 || !isDeciding) && (
                    <div className={styles.conversationDivider}>Conversation</div>
                  )}
                  {analysis.messages.length === 0 && !isDeciding && (
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

            {/* Composer only once the assessment is done, and hidden while the
                decision form is open, so the footer holds one task at a time. */}
            {showConversation && !isDeciding && !analysis.decision && (
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
                    <button type="button" className={styles.stopButton} onClick={analysis.stopTurn}>
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
              {isWorking ? (
                <>
                  <span className={styles.runningNote}>
                    <span className={styles.stepSpinner} />
                    {isRunning
                      ? " Analysing — this usually takes under two minutes. You can close this window; the assessment carries on and you'll be told when it's ready."
                      : " Waiting to be processed. It starts automatically when the agent is free."}
                  </span>
                </>
              ) : analysis.phase === "complete" ? (
                <CloseCaseBar
                  decision={analysis.decision}
                  persistence={analysis.persistence}
                  isSubmitting={analysis.isSubmitting}
                  isStreaming={analysis.isStreaming}
                  error={analysis.decisionError}
                  isOpen={isDeciding}
                  onOpen={() => setIsDeciding(true)}
                  onCancel={() => setIsDeciding(false)}
                  onDecide={decide}
                />
              ) : (
                <span className={styles.runningNote}>
                  Add the claim to the queue again to re-run its assessment.
                </span>
              )}
            </div>
          </div>

          {/* The agent's own trace, alongside the conversation: watched while the
              run happens, and afterwards the evidence for how the report was
              reached. It collapses to a narrow rail to give the report room. */}
          <aside className={`${styles.aside} ${isActivityCollapsed ? styles.asideCollapsed : ""}`}>
            <button
              type="button"
              className={styles.asideToggle}
              onClick={() => setIsActivityCollapsed((collapsed) => !collapsed)}
              aria-expanded={!isActivityCollapsed}
              title={isActivityCollapsed ? "Show agent activity" : "Hide agent activity"}
            >
              <span className={styles.asideChevron}>
                <Icon name="chevronDown" size={12} />
              </span>
              <span className={styles.asideTitle}>
                Agent activity{analysis.steps.length ? ` · ${analysis.steps.length}` : ""}
              </span>
              {isActivityCollapsed && isRunning && <span className={styles.stepSpinner} />}
            </button>
            {!isActivityCollapsed && (
              <div className={styles.asideScroll}>
                <StepList steps={analysis.steps} isRunning={isRunning} />

                {isWorking && !analysis.steps.length && (
                  <div className={styles.step}>
                    <span className={styles.stepSpinner} />
                    <span className={styles.stepTextActive}>
                      {isRunning ? "Starting the agent…" : "Waiting to be processed…"}
                    </span>
                  </div>
                )}

                {!isWorking && !analysis.steps.length && (
                  <div className={styles.asideEmpty}>
                    The agent reported no tool activity for this run.
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
