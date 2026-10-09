"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/icons/Icons";
import { humanizeEnum, toMoney } from "@/lib/claimsPresenter";
import styles from "./AssessmentQueuePanel.module.css";
import { QUEUE_STATUS } from "./useAssessmentQueue";

/* Assessment statuses — where a claim is in the queue. Deliberately not the
   claim status pills (Not analysed, Pending review…): different words, and a
   dot-and-text style rather than a pill, so the two are never confused. */
const STATUS_LABEL = {
  [QUEUE_STATUS.WAITING]: "Waiting to be processed",
  [QUEUE_STATUS.PROCESSING]: "Processing",
  [QUEUE_STATUS.READY_FOR_REVIEW]: "Ready for review",
  [QUEUE_STATUS.DECIDED]: "Decision recorded",
  [QUEUE_STATUS.FAILED]: "Did not finish",
};

const STATUS_CLASS = {
  [QUEUE_STATUS.WAITING]: styles.isWaiting,
  [QUEUE_STATUS.PROCESSING]: styles.isProcessing,
  [QUEUE_STATUS.READY_FOR_REVIEW]: styles.isReady,
  [QUEUE_STATUS.DECIDED]: styles.isDecided,
  [QUEUE_STATUS.FAILED]: styles.isFailed,
};

/** Real wall-clock time, ticking once a second while the panel is open. */
function useNow(isActive) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);
  return now;
}

/** The API's timestamps are UTC but may arrive without a zone suffix (PyMongo
 *  returns naive datetimes); unmarked, the browser would read them as local. */
function parseUtc(iso) {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

function toDuration(fromIso, now) {
  if (!fromIso) return null;
  const seconds = Math.max(0, Math.round((now - parseUtc(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The one line of timing a card shows, depending on where the job is. */
function toTiming(job, now) {
  switch (job.status) {
    case QUEUE_STATUS.WAITING:
      return `Queued ${toDuration(job.enqueuedAt, now)} ago`;
    case QUEUE_STATUS.PROCESSING:
      return `Running ${toDuration(job.startedAt, now)}`;
    case QUEUE_STATUS.READY_FOR_REVIEW:
      return `Finished ${toDuration(job.finishedAt, now)} ago`;
    default:
      return null;
  }
}

function QueueCard({ job, position, now, isOpenInWindow, isHighlighted, onOpen, onRemove }) {
  const canOpen = job.status !== QUEUE_STATUS.WAITING && job.status !== QUEUE_STATUS.DECIDED;
  // Removing is only allowed before the assessment starts; a failure can be dismissed.
  const canRemove = job.status === QUEUE_STATUS.WAITING || job.status === QUEUE_STATUS.FAILED;
  const claim = job.claim || {};
  const subtitle = [claim.customerName, humanizeEnum(claim.claimType)].filter(Boolean).join(" · ");
  const timing = toTiming(job, now);
  const isRecording = job.decisionStatus === "RECORDING";
  const statusLabel = isRecording ? "Recording decision" : STATUS_LABEL[job.status] || job.status;

  const open = () => canOpen && onOpen(job);

  return (
    <li
      className={[
        styles.card,
        STATUS_CLASS[job.status] || "",
        canOpen ? styles.cardClickable : "",
        isOpenInWindow ? styles.cardOpen : "",
        isHighlighted ? styles.cardFlash : "",
      ].join(" ")}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (canOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
      aria-label={canOpen ? `Open the assessment of ${job.claimId}` : undefined}
    >
      <div className={styles.cardTop}>
        <span className={styles.claimId}>{job.claimId}</span>
        {position && <span className={styles.position}>#{position}</span>}
        {canRemove && (
          <button
            type="button"
            className={styles.remove}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(job);
            }}
            aria-label={`Remove ${job.claimId} from the queue`}
            title={job.status === QUEUE_STATUS.FAILED ? "Dismiss" : "Remove from the queue"}
          >
            <Icon name="close" size={10} />
          </button>
        )}
      </div>

      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}

      <div className={styles.cardBottom}>
        <span className={styles.status}>
          {job.status === QUEUE_STATUS.PROCESSING || isRecording ? (
            <span className={styles.spinner} />
          ) : (
            <span className={styles.dot} />
          )}
          {statusLabel}
        </span>
        {claim.claimAmount != null && (
          <span className={styles.amount}>{toMoney(claim.claimAmount)}</span>
        )}
      </div>

      {(timing || job.status === QUEUE_STATUS.READY_FOR_REVIEW) && (
        <div className={styles.cardMeta}>
          {timing && <span>{timing}</span>}
          {job.status === QUEUE_STATUS.READY_FOR_REVIEW && !isRecording && (
            <span className={styles.cta}>Review →</span>
          )}
        </div>
      )}

      {job.status === QUEUE_STATUS.PROCESSING && <div className={styles.progress} />}
    </li>
  );
}

/**
 * The Fraud Assessment Queue, docked on the right of the app. Collapsed it is a
 * slim tab with a counter; open it lists every claim in the queue, and is how
 * the reviewer gets back to any assessment.
 */
export default function AssessmentQueuePanel({
  jobs,
  error,
  isOpen,
  openJobId,
  highlightJobId,
  onToggle,
  onOpenJob,
  onRemoveJob,
}) {
  const now = useNow(isOpen);
  const count = jobs.filter((job) => job.status !== QUEUE_STATUS.DECIDED).length;
  const readyCount = jobs.filter((job) => job.status === QUEUE_STATUS.READY_FOR_REVIEW).length;
  let waitingPosition = 0;

  if (!isOpen) {
    return (
      <aside className={styles.rail}>
        <button
          type="button"
          className={styles.railButton}
          onClick={onToggle}
          aria-label={`Open the Fraud Assessment Queue (${count})`}
        >
          <span className={`${styles.badge} ${readyCount ? styles.badgePulse : ""}`}>{count}</span>
          <span className={styles.railLabel}>Fraud Assessment Queue</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Fraud Assessment Queue">
      <div className={styles.header}>
        <div className={styles.title}>
          Fraud Assessment Queue
          <span className={`${styles.badge} ${readyCount ? styles.badgePulse : ""}`}>{count}</span>
        </div>
        <button
          type="button"
          className={styles.collapse}
          onClick={onToggle}
          aria-label="Collapse the queue"
          title="Collapse"
        >
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
      <p className={styles.hint}>
        The agent assesses one claim at a time, in order. Use Analyze on any claim to add it.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {jobs.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="inbox" size={18} />
          The queue is empty.
        </div>
      ) : (
        <ul className={styles.list}>
          {jobs.map((job) => {
            const position =
              job.status === QUEUE_STATUS.WAITING ? (waitingPosition += 1) : null;
            return (
              <QueueCard
                key={job.jobId}
                job={job}
                position={position}
                now={now}
                isOpenInWindow={job.jobId === openJobId}
                isHighlighted={job.jobId === highlightJobId}
                onOpen={onOpenJob}
                onRemove={onRemoveJob}
              />
            );
          })}
        </ul>
      )}
    </aside>
  );
}
