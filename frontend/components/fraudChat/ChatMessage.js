"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./FraudChat.module.css";

/* Tailwind's preflight strips list bullets and heading margins, so every block
   element the agent can emit needs an explicit class. */
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
  a: ({ href, children }) => (
    <a className={styles.mdLink} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className={styles.mdTableWrap}>
      <table className={styles.mdTable}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={styles.mdTh}>{children}</th>,
  td: ({ children }) => <td className={styles.mdTd}>{children}</td>,
  hr: () => <hr className={styles.mdRule} />,
};

/** A leading "Thinking…" is a status line the agent prepends, not an answer. */
const THINKING_ONLY = /^thinking\.{0,3}\s*$/i;
const THINKING_PREFIX = /^thinking\.{0,3}\s*/i;

function AssistantBody({ content, done, activity }) {
  if (!content) {
    return activity ? (
      <span className={styles.activity}>
        <span className={styles.spinner} aria-hidden="true" />
        {activity}
      </span>
    ) : (
      <span className={styles.caret} aria-label="The agent is thinking" />
    );
  }

  if (THINKING_ONLY.test(content)) {
    return <span className={styles.activity}>{content}</span>;
  }

  const text = content.replace(THINKING_PREFIX, "");

  // Markdown renders once, on completion. Reparsing the whole accumulated
  // string on every token saturates the main thread on a long answer, so a
  // streaming reply is plain pre-wrapped text until `done`.
  if (!done) return <span className={styles.streamingText}>{text}</span>;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

/**
 * One turn in the feed. Memoized on primitives only, so a token arriving for
 * the newest reply does not re-render the whole transcript behind it.
 */
function ChatMessage({ role, content, done, activity, status, suspendContext }) {
  if (role === "user") {
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{content}</div>
      </div>
    );
  }

  if (role === "error") {
    return (
      <div className={styles.assistantRow}>
        <span className={styles.speaker}>Fraud agent</span>
        <div className={styles.errorBubble}>{content}</div>
      </div>
    );
  }

  return (
    <div className={styles.assistantRow}>
      <span className={styles.speaker}>Fraud agent</span>
      <div className={styles.assistantBubble}>
        <AssistantBody content={content} done={done} activity={activity} />

        {/* The agent can stop and ask for a human decision. Approving from here
            is iteration 2 (the /api/chat/resume route is already in place) — for
            now the run is surfaced rather than left looking unanswered. */}
        {status === "suspended" && (
          <div className={styles.suspendNote}>
            <span className={styles.suspendTitle}>Paused for human review</span>
            <span>
              {(typeof suspendContext === "object" ? suspendContext?.reason : suspendContext) ||
                "The agent needs an approval before it can continue."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChatMessage);
