"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

function DecisionBar({ decision, verdictRecommendsSiu, isSubmitting, error, onDecide }) {
  const [siuChecked, setSiuChecked] = useState(Boolean(verdictRecommendsSiu));
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");

  // A recorded decision and the buttons are mutually exclusive: the modal must
  // not offer to decide again.
  if (decision) {
    return (
      <div className={styles.decisionMade}>
        <Icon name="check" size={12} />
        {decision.state === "confirmed"
          ? `Confirmed as fraud${decision.siuReferred ? " · referred to SIU" : ""}`
          : "Dismissed"}
      </div>
    );
  }

  return (
    <div className={styles.decisionArea}>
      <div className={styles.decisionButtons}>
        <button
          type="button"
          className={styles.btnConfirm}
          disabled={isSubmitting}
          onClick={() => onDecide({ decision: "CONFIRMED_FRAUD", siuReferred: siuChecked })}
        >
          Confirm fraud
        </button>
        <button
          type="button"
          className={styles.btnOutline}
          disabled={isSubmitting}
          onClick={() => setIsDismissing(true)}
        >
          Dismiss
        </button>
        <label className={styles.siuRow}>
          <input
            type="checkbox"
            checked={siuChecked}
            onChange={(event) => setSiuChecked(event.target.checked)}
          />
          Also refer to SIU
        </label>
      </div>

      {/* Dismissing never submits on the first click — the reason is required,
          so the field is gated in front of the submission. */}
      {isDismissing && (
        <div className={styles.dismissForm}>
          <textarea
            className={styles.textarea}
            placeholder="Reason for dismissal (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
          <button
            type="button"
            className={styles.btnOutline}
            disabled={!reason.trim() || isSubmitting}
            onClick={() => onDecide({ decision: "DISMISSED", dismissReason: reason.trim() })}
          >
            Submit dismissal
          </button>
        </div>
      )}

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
    await analysis.recordDecision(payload);
    // Lets the claim view refetch, so its status pill stops disagreeing with
    // the decision just recorded.
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
        </div>

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
            <DecisionBar
              decision={analysis.decision}
              verdictRecommendsSiu={false}
              isSubmitting={analysis.isSubmitting}
              error={analysis.decisionError}
              onDecide={decide}
            />
          )}
        </div>
      </div>
    </>
  );
}
