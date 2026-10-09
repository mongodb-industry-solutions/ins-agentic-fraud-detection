"use client";

import { useCallback, useState } from "react";

import AnalysisModal from "@/components/analysisModal/AnalysisModal";
import AppShell from "@/components/appShell/AppShell";
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
import { SECTION_LABEL, SECTION_TITLE } from "@/lib/const/nav";

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
  // The claim currently being assessed by the agent. Owned here rather than in
  // Dashboard or ClaimView so the same overlay serves every entry point, and so
  // it survives navigating between them.
  const [analyzeClaimId, setAnalyzeClaimId] = useState(null);
  // Closing the overlay mid-run minimises it to a pill instead of unmounting,
  // so the agent keeps working while the reviewer moves around the app.
  const [isAnalysisMinimized, setIsAnalysisMinimized] = useState(false);

  // "Analyze for fraud" on the claim already being assessed reopens that run
  // rather than starting another one. A different claim replaces it.
  const analyze = useCallback((claimId) => {
    setAnalyzeClaimId(claimId);
    setIsAnalysisMinimized(false);
  }, []);

  const closeAnalysis = useCallback(() => {
    setAnalyzeClaimId(null);
    setIsAnalysisMinimized(false);
  }, []);
  // Bumped when a decision is recorded, to make the views behind the overlay
  // refetch — otherwise a claim's status pill keeps contradicting the decision
  // that was just committed.
  const [dataVersion, setDataVersion] = useState(0);

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
      <AppShell activeSection={activeSection} onNavigate={navigate}>
        {current ? renderDetail() : renderSection()}
      </AppShell>

      {analyzeClaimId && (
        <AnalysisModal
          key={analyzeClaimId}
          claimId={analyzeClaimId}
          isMinimized={isAnalysisMinimized}
          onMinimize={() => setIsAnalysisMinimized(true)}
          onRestore={() => setIsAnalysisMinimized(false)}
          onClose={closeAnalysis}
          onDecided={() => setDataVersion((version) => version + 1)}
        />
      )}
      {/* Outside AppShell: the launcher and its modal are fixed to the viewport
          and must not sit inside the shell's blurred/scrolling layers. */}
      <FraudChat />
    </>
  );
}
