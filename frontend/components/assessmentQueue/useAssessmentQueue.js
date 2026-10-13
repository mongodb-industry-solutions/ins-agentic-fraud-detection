"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/shared/ToastProvider";
import {
  enqueueAssessment,
  listAssessmentQueue,
  removeAssessmentJob,
} from "@/lib/api/assessmentQueue";

// Polled faster while the agent is working, so the panel's status follows the
// run closely; slower when only reviews are pending.
const BUSY_POLL_MS = 2000;
const IDLE_POLL_MS = 6000;

export const QUEUE_STATUS = {
  WAITING: "WAITING",
  PROCESSING: "PROCESSING",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  DECIDED: "DECIDED",
  FAILED: "FAILED",
};

/** Jobs a claim is "in the queue" with: the ones Analyze must not duplicate. */
export const LIVE_STATUSES = [
  QUEUE_STATUS.WAITING,
  QUEUE_STATUS.PROCESSING,
  QUEUE_STATUS.READY_FOR_REVIEW,
];

/**
 * The Fraud Assessment Queue as the browser sees it. The backend owns the queue
 * and runs it; this only polls the list and forwards the reviewer's actions.
 */
export default function useAssessmentQueue({ onJobFinished } = {}) {
  const [jobs, setJobs] = useState([]);
  const onJobFinishedRef = useRef(onJobFinished);
  onJobFinishedRef.current = onJobFinished;
  const [error, setError] = useState(null);
  const showToast = useToast();
  const previousStatusRef = useRef(new Map());
  const previousDecisionRef = useRef(new Map());
  const jobsRef = useRef([]);

  const apply = useCallback(
    (response) => {
      const next = response?.jobs || [];
      // Tell the reviewer when a run finishes, whatever screen they are on.
      next.forEach((job) => {
        const before = previousStatusRef.current.get(job.jobId);
        const assessed = before === QUEUE_STATUS.PROCESSING && job.status !== QUEUE_STATUS.PROCESSING;
        const decided = before && before !== QUEUE_STATUS.DECIDED && job.status === QUEUE_STATUS.DECIDED;
        // Either one changed a claim, so the views behind the queue refetch.
        if (assessed || decided) onJobFinishedRef.current?.(job);
        if (decided) showToast(`Decision recorded for ${job.claimId}.`);
        if (
          job.decisionStatus === "FAILED" &&
          previousDecisionRef.current.get(job.jobId) === "RECORDING"
        ) {
          showToast(`The decision on ${job.claimId} was not recorded. Open it to try again.`);
        }
        if (before === QUEUE_STATUS.PROCESSING && job.status === QUEUE_STATUS.READY_FOR_REVIEW) {
          showToast(`The assessment of ${job.claimId} is complete and ready for review.`);
        } else if (before === QUEUE_STATUS.PROCESSING && job.status === QUEUE_STATUS.FAILED) {
          showToast(`The assessment of ${job.claimId} did not finish.`);
        }
      });
      previousStatusRef.current = new Map(next.map((job) => [job.jobId, job.status]));
      previousDecisionRef.current = new Map(next.map((job) => [job.jobId, job.decisionStatus]));
      jobsRef.current = next;
      setJobs(next);
      setError(null);
      return next;
    },
    [showToast]
  );

  const refresh = useCallback(async () => {
    try {
      return apply(await listAssessmentQueue());
    } catch (fetchError) {
      setError(fetchError.message || "Could not load the Fraud Assessment Queue.");
      return jobsRef.current;
    }
  }, [apply]);

  const isBusy = jobs.some(
    (job) =>
      job.status === QUEUE_STATUS.PROCESSING ||
      job.status === QUEUE_STATUS.WAITING ||
      job.decisionStatus === "RECORDING"
  );
  // Decided cards disappear after a few seconds server-side, so keep polling
  // while one is on screen.
  const hasTransient = jobs.some((job) => job.status === QUEUE_STATUS.DECIDED);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, isBusy || hasTransient ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, isBusy, hasTransient]);

  const enqueue = useCallback(
    async (claimId, requestedBy) => {
      const job = await enqueueAssessment(claimId, requestedBy);
      await refresh();
      return job;
    },
    [refresh]
  );

  const remove = useCallback(
    async (jobId) => {
      try {
        await removeAssessmentJob(jobId);
      } catch (removeError) {
        showToast(removeError.message || "Could not remove the claim from the queue.");
      }
      await refresh();
    },
    [refresh, showToast]
  );

  /** Whether the agent is busy right now: something processing or waiting. */
  const hasActiveAssessment = useCallback(
    () =>
      jobsRef.current.some(
        (job) => job.status === QUEUE_STATUS.PROCESSING || job.status === QUEUE_STATUS.WAITING
      ),
    []
  );

  const findLiveJob = useCallback(
    (claimId) =>
      jobsRef.current.find((job) => job.claimId === claimId && LIVE_STATUSES.includes(job.status)),
    []
  );

  return {
    jobs,
    error,
    isBusy,
    refresh,
    enqueue,
    remove,
    findLiveJob,
    hasActiveAssessment,
  };
}
