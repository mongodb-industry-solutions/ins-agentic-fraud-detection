"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import ChatMessage from "@/components/fraudChat/ChatMessage";
import Icon from "@/components/icons/Icons";
import { useToast } from "@/components/shared/ToastProvider";
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
            : "Dismissed"}
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
 * The minimised assessment: a small pill pinned to the corner of every screen,
 * so the reviewer can keep working while the agent runs and come back to it.
 * It turns into the "ready for review" reminder once the run finishes.
 */
function MinimizedPill({ claimId, phase, decision, onRestore, onDiscard }) {
  const isRunning = phase === "running";
  const label = isRunning
    ? `Assessing ${claimId}…`
    : phase === "error"
      ? `${claimId} assessment did not finish`
      : decision
        ? `${claimId} decision recorded`
        : `${claimId} assessment ready for review`;

  return (
    <div
      className={`${styles.pill} ${!isRunning && !decision ? styles.pillReady : ""}`}
      role="status"
      aria-live="polite"
    >
      <button type="button" className={styles.pillMain} onClick={onRestore}>
        {isRunning ? (
          <span className={styles.stepSpinner} />
        ) : (
          <Icon name={phase === "error" ? "alert" : "checkCircle"} size={14} />
        )}
        <span className={styles.pillLabel}>{label}</span>
        <span className={styles.pillAction}>{isRunning ? "Show" : "Open"}</span>
      </button>
      <button
        type="button"
        className={styles.pillDismiss}
        onClick={onDiscard}
        aria-label={isRunning ? "Stop and discard this assessment" : "Dismiss"}
        title={isRunning ? "Stop and discard this assessment" : "Dismiss"}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}

/**
 * The live fraud-analysis overlay: streams the agent's run, then shows its
 * report and the confirm/dismiss decision.
 *
 * Closing it while the agent works does not cancel anything: the component
 * stays mounted and collapses into a MinimizedPill, so the run continues and
 * the reviewer is told when it is ready. Only the pill's dismiss discards it.
 *
 * The report is the agent's markdown prose. Once the agent emits a structured
 * payload, `FraudReportContent` replaces the markdown block here and nothing
 * else in this shell changes.
 */
export default function AnalysisModal({
  claimId,
  isMinimized,
  onMinimize,
  onRestore,
  onClose,
  onDecided,
}) {
  const analysis = useAnalysisModal(claimId);
  const isRunning = analysis.phase === "running";
  const showToast = useToast();

  const [draft, setDraft] = useState("");
  // The decision form replaces the composer while it is open, so the footer
  // shows one task at a time.
  const [isDeciding, setIsDeciding] = useState(false);
  const [isActivityCollapsed, setIsActivityCollapsed] = useState(false);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  // Lets the report render as markdown while it streams without re-parsing on
  // every token; flushed exactly once the run finishes.
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
    if (!isMinimized && !isRunning && !analysis.isStreaming && !isDeciding) {
      inputRef.current?.focus();
    }
  }, [isMinimized, isRunning, analysis.isStreaming, isDeciding]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [analysis.messages]);

  // Tell a reviewer who walked away that the run finished. Only on the
  // transition out of "running", and only when the modal is not on screen.
  const previousPhaseRef = useRef(analysis.phase);
  useEffect(() => {
    const finished = previousPhaseRef.current === "running" && analysis.phase !== "running";
    previousPhaseRef.current = analysis.phase;
    if (finished && isMinimized) {
      showToast(
        analysis.phase === "error"
          ? `The assessment of ${claimId} did not finish.`
          : `The assessment of ${claimId} is complete and ready for review.`
      );
    }
  }, [analysis.phase, isMinimized, claimId, showToast]);

  // Once a decision is recorded there is nothing to come back to, so closing
  // really closes. Before that, closing minimises and the run carries on.
  const close = useCallback(() => {
    if (analysis.decision) onClose();
    else onMinimize();
  }, [analysis.decision, onClose, onMinimize]);

  const discard = useCallback(() => {
    analysis.stop();
    onClose();
  }, [analysis, onClose]);

  useEffect(() => {
    if (isMinimized) return undefined;
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
  }, [close, isMinimized]);

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

  // A recorded decision ends the decision task, so the form closes with it.
  useEffect(() => {
    if (analysis.decision) setIsDeciding(false);
  }, [analysis.decision]);

  if (isMinimized) {
    return (
      <MinimizedPill
        claimId={claimId}
        phase={analysis.phase}
        decision={analysis.decision}
        onRestore={onRestore}
        onDiscard={discard}
      />
    );
  }

  const showConversation = !isRunning && analysis.phase !== "error";

  return (
    <>
      {/* Clicking outside minimises rather than discards, so a stray click
          never loses a run in progress. */}
      <div className={styles.backdrop} onClick={close} />
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
                : analysis.phase === "error"
                  ? "The analysis did not finish"
                  : "Assessment complete and recorded — awaiting your decision"}
            </div>
          </div>
          {/* Until a decision is recorded, leaving never cancels the run: it
              minimises to the corner pill. After that, there is nothing to come
              back to, so it is a plain close. */}
          {analysis.decision ? (
            <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">
              ✕
            </button>
          ) : (
            <button
              type="button"
              className={styles.laterBtn}
              onClick={close}
              title="Hide this window — reopen it any time from the corner of the screen"
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
                  {/* Formatted as it arrives, from a throttled copy of the text:
                      parsing the whole accumulated report on every token is what
                      saturates the main thread, not parsing it repeatedly. See
                      useThrottledText. */}
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                    {streamedReport}
                  </ReactMarkdown>
                </div>
              )}

              {/* The report is the first turn of a conversation, so the follow-up
                  transcript continues in the same scroll area rather than in a
                  separate panel. Turns use the same ChatMessage component as the
                  fraud chat, so a reply reads identically in both places. */}
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

            {/* Composer only once the assessment is done — there is nothing to ask
                about mid-run — and hidden while the decision form is open, so the
                footer holds one task at a time. */}
            {showConversation && !isDeciding && (
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
                    minutes. Choose &ldquo;Come back later&rdquo; to keep using the app; you&apos;ll
                    be told when it&apos;s ready.
                  </span>
                  <span className={styles.footerSpacer} />
                  <button type="button" className={styles.btnStop} onClick={analysis.stop}>
                    Stop assessment
                  </button>
                </>
              ) : (
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
              )}
            </div>
          </div>

          {/* The agent's own trace, alongside the conversation rather than above
              it: while the run happens this is the only thing moving, and
              afterwards it is the evidence for how the report was reached. It
              collapses to a narrow rail to give the report the full width. */}
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

                {isRunning && !analysis.steps.length && (
                  <div className={styles.step}>
                    <span className={styles.stepSpinner} />
                    <span className={styles.stepTextActive}>Starting the agent…</span>
                  </div>
                )}

                {!isRunning && !analysis.steps.length && (
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
