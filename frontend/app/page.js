"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AnalysisModal from "@/components/analysisModal/AnalysisModal";
import AppShell from "@/components/appShell/AppShell";
import { AnalyzeLabelProvider } from "@/components/assessmentQueue/AnalyzeLabelContext";
import AssessmentQueuePanel from "@/components/assessmentQueue/AssessmentQueuePanel";
import useAssessmentQueue, { QUEUE_STATUS } from "@/components/assessmentQueue/useAssessmentQueue";
import ClaimView from "@/components/claimView/ClaimView";
import CustomerDetail from "@/components/customerDetail/CustomerDetail";
import CustomersList from "@/components/customersList/CustomersList";
import Dashboard from "@/components/dashboard/Dashboard";
import FraudChat from "@/components/fraudChat/FraudChat";
import FraudIntelligenceView from "@/components/fraudIntelligence/FraudIntelligenceView";
import FraudPatternsView from "@/components/fraudPatterns/FraudPatternsView";
import PoliciesList from "@/components/policiesList/PoliciesList";
import PolicyDetail from "@/components/policyDetail/PolicyDetail";
import SectionPlaceholder from "@/components/sectionPlaceholder/SectionPlaceholder";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/ToastProvider";
import { PROFILE, SECTION_LABEL, SECTION_TITLE } from "@/lib/const/nav";

/**
 * The only route. Navigation is component state.
 *
 * `activeSection` is what the sidebar highlights, and it is never changed by
 * drilling into a record. `detailStack` holds the drill-in path as entries of
 * {type, id}: the last entry is what renders, and Back pops one level. Because
 * the stack is separate from the section, the origin section stays highlighted
 * however deep you go, and Back walks the real path you took rather than
 * assuming everything came from the Dashboard.
 */
export default function Home() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [detailStack, setDetailStack] = useState([]);
  // Set only by the "Analyze for fraud" entry point, which exists to send
  // someone to a claim specifically to trigger analysis.
  const [nudgeAnalyze, setNudgeAnalyze] = useState(false);
  // Bumped when an assessment finishes or a decision is recorded, to make the
  // views behind the overlay refetch — otherwise a claim's status pill keeps
  // contradicting what the agent just wrote.
  const [dataVersion, setDataVersion] = useState(0);
  const refreshViews = useCallback(() => setDataVersion((version) => version + 1), []);

  // The Fraud Assessment Queue is run by the backend; this polls it.
  const queue = useAssessmentQueue({ onJobFinished: refreshViews });
  const showToast = useToast();
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  // What every Analyze button reads to label itself (see AnalyzeLabelContext).
  const analyzeLabels = useMemo(
    () => ({
      statusByClaim: new Map(
        queue.jobs
          .filter((job) => job.status === QUEUE_STATUS.PROCESSING || job.status === QUEUE_STATUS.WAITING)
          .map((job) => [job.claimId, job.status])
      ),
      isBusy: queue.jobs.some(
        (job) => job.status === QUEUE_STATUS.PROCESSING || job.status === QUEUE_STATUS.WAITING
      ),
    }),
    [queue.jobs]
  );
  // The job shown in the assessment window: {jobId, claimId}, or null.
  const [openJob, setOpenJob] = useState(null);
  // A claim waiting for the "add it to the queue?" confirmation.
  const [pendingClaimId, setPendingClaimId] = useState(null);
  // The queue card that flashes after an assessment window is closed.
  const [highlightJobId, setHighlightJobId] = useState(null);
  const highlightTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(highlightTimerRef.current), []);

  /**
   * Closing an assessment window (or "Come back later") shows the reviewer
   * where it went: the queue slides open and the claim the agent is processing
   * flashes — or, if nothing is processing, the claim they just left.
   */
  const closeAssessment = useCallback(() => {
    const closed = openJob;
    setOpenJob(null);
    if (!closed) return;
    const processing = queue.jobs.find((job) => job.status === QUEUE_STATUS.PROCESSING);
    const target = processing?.jobId || closed.jobId;
    if (!queue.jobs.some((job) => job.jobId === target)) return;
    setIsQueueOpen(true);
    setHighlightJobId(target);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightJobId(null), 2400);
  }, [openJob, queue.jobs]);

  const addToQueue = useCallback(
    async (claimId, { openWindow }) => {
      try {
        const job = await queue.enqueue(claimId, `analyst:${PROFILE.name}`);
        if (openWindow) setOpenJob({ jobId: job.jobId, claimId });
        else setIsQueueOpen(true);
      } catch (error) {
        showToast(error.message || `Could not add ${claimId} to the queue.`);
      }
    },
    [queue, showToast]
  );

  /**
   * Every "Analyze for fraud" button lands here. With the agent free the
   * assessment starts and its window opens; with an assessment already under
   * way the reviewer is asked whether to queue this claim behind it.
   */
  const analyze = useCallback(
    (claimId) => {
      const existing = queue.findLiveJob(claimId);
      if (existing) {
        if (existing.status === QUEUE_STATUS.WAITING) {
          setIsQueueOpen(true);
          showToast(`${claimId} is already in the Fraud Assessment Queue.`);
        } else {
          setOpenJob({ jobId: existing.jobId, claimId });
        }
        return;
      }
      if (queue.hasActiveAssessment()) setPendingClaimId(claimId);
      else addToQueue(claimId, { openWindow: true });
    },
    [queue, addToQueue, showToast]
  );

  /**
   * After a decision the backend has confirmed, the window moves on to the next
   * claim — one ready for review first, otherwise the one the agent is
   * processing now. A short pause lets the reviewer see it was verified.
   */
  const nextTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(nextTimerRef.current), []);
  const onDecided = useCallback(
    (jobId) => {
      refreshViews();
      clearTimeout(nextTimerRef.current);
      nextTimerRef.current = setTimeout(async () => {
        const jobs = await queue.refresh();
        const next =
          jobs.find(
            (job) =>
              job.status === QUEUE_STATUS.READY_FOR_REVIEW &&
              job.jobId !== jobId &&
              job.decisionStatus !== "RECORDING"
          ) || jobs.find((job) => job.status === QUEUE_STATUS.PROCESSING);
        setOpenJob((current) => {
          // The reviewer may have closed the window or opened another claim.
          if (!current || current.jobId !== jobId || !next) return current;
          showToast(`Next in the queue: ${next.claimId}`);
          return { jobId: next.jobId, claimId: next.claimId };
        });
      }, 1500);
    },
    [queue, refreshViews, showToast]
  );

  const push = useCallback((entry, options = {}) => {
    setDetailStack((stack) => [...stack, entry]);
    setNudgeAnalyze(Boolean(options.analyze));
  }, []);

  const openClaim = useCallback(
    (claimId, options = {}) => push({ type: "claim", id: claimId }, options),
    [push]
  );
  const openCustomer = useCallback((customerId) => push({ type: "customer", id: customerId }), [push]);
  const openPolicy = useCallback((policyId) => push({ type: "policy", id: policyId }), [push]);

  const goBack = useCallback(() => {
    setDetailStack((stack) => stack.slice(0, -1));
    setNudgeAnalyze(false);
  }, []);

  // Switching section always lands on that section's list view, never mid-drill
  // into something viewed earlier.
  const navigate = useCallback((sectionId) => {
    setActiveSection(sectionId);
    setDetailStack([]);
    setNudgeAnalyze(false);
  }, []);

  const current = detailStack[detailStack.length - 1] || null;
  const previous = detailStack[detailStack.length - 2] || null;

  // Back names where it actually returns to: the previous record if there is
  // one, otherwise the section the drill started from.
  const backLabel = previous
    ? `Back to ${previous.id}`
    : `Back to ${SECTION_LABEL[activeSection] || "list"}`;

  function renderDetail() {
    switch (current.type) {
      case "customer":
        return (
          <CustomerDetail
            customerId={current.id}
            backLabel={backLabel}
            onBack={goBack}
            onOpenPolicy={openPolicy}
            onOpenClaim={openClaim}
          />
        );
      case "policy":
        return (
          <PolicyDetail
            policyId={current.id}
            backLabel={backLabel}
            onBack={goBack}
            onOpenCustomer={openCustomer}
            onOpenClaim={openClaim}
          />
        );
      default:
        return (
          <ClaimView
            key={`${current.id}-${dataVersion}`}
            claimId={current.id}
            backLabel={backLabel}
            onBack={goBack}
            onOpenClaim={openClaim}
            onAnalyze={analyze}
            nudgeAnalyze={nudgeAnalyze}
          />
        );
    }
  }

  function renderSection() {
    switch (activeSection) {
      case "dashboard":
        return (
          <Dashboard
            key={dataVersion}
            onOpenClaim={openClaim}
            onAnalyze={analyze}
          />
        );
      case "customers":
        return <CustomersList onOpenCustomer={openCustomer} />;
      case "policies":
        return <PoliciesList onOpenPolicy={openPolicy} />;
      case "fraudPatterns":
        // Opening a matched claim pushes onto the same detailStack every other
        // claim reference uses, so Back returns here.
        return <FraudPatternsView onOpenClaim={openClaim} />;
      case "fraudIntelligence":
        // Its six sub-tabs are internal state, so they never touch detailStack.
        // Drilling into a claim from one of them does, and Back returns here
        // because activeSection is unchanged by the drill.
        return <FraudIntelligenceView key={dataVersion} onOpenClaim={openClaim} />;
      default:
        return <SectionPlaceholder label={SECTION_TITLE[activeSection]} />;
    }
  }

  return (
    <>
      <AppShell
        activeSection={activeSection}
        onNavigate={navigate}
        rightPanel={
          <AssessmentQueuePanel
            jobs={queue.jobs}
            error={queue.error}
            isOpen={isQueueOpen}
            openJobId={openJob?.jobId}
            highlightJobId={highlightJobId}
            onToggle={() => setIsQueueOpen((open) => !open)}
            onOpenJob={(job) => setOpenJob({ jobId: job.jobId, claimId: job.claimId })}
            onRemoveJob={(job) => queue.remove(job.jobId)}
          />
        }
      >
        <AnalyzeLabelProvider value={analyzeLabels}>
          {current ? renderDetail() : renderSection()}
        </AnalyzeLabelProvider>
      </AppShell>

      {openJob && (
        <AnalysisModal
          key={openJob.jobId}
          jobId={openJob.jobId}
          claimId={openJob.claimId}
          onClose={closeAssessment}
          onDecided={onDecided}
        />
      )}
      {pendingClaimId && (
        <ConfirmDialog
          title="Add to the Fraud Assessment Queue?"
          message={`An assessment is already in progress. This action will add the assessment of ${pendingClaimId} to the queue, and the agent will start it as soon as it is free. Do you want this claim to be added to the queue?`}
          confirmLabel="Add to queue"
          onConfirm={() => {
            const claimId = pendingClaimId;
            setPendingClaimId(null);
            addToQueue(claimId, { openWindow: false });
          }}
          onCancel={() => setPendingClaimId(null)}
        />
      )}
      {/* Outside AppShell: the launcher and its modal are fixed to the viewport
          and must not sit inside the shell's blurred/scrolling layers. */}
      <FraudChat />
    </>
  );
}
