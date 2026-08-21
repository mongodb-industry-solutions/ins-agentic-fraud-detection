"use client";

import { useCallback, useState } from "react";

import AppShell from "@/components/appShell/AppShell";
import ClaimView from "@/components/claimView/ClaimView";
import CustomerDetail from "@/components/customerDetail/CustomerDetail";
import CustomersList from "@/components/customersList/CustomersList";
import Dashboard from "@/components/dashboard/Dashboard";
import FraudChat from "@/components/fraudChat/FraudChat";
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
            claimId={current.id}
            backLabel={backLabel}
            onBack={goBack}
            onOpenClaim={openClaim}
            nudgeAnalyze={nudgeAnalyze}
          />
        );
    }
  }

  function renderSection() {
    switch (activeSection) {
      case "dashboard":
        return <Dashboard onOpenClaim={openClaim} />;
      case "customers":
        return <CustomersList onOpenCustomer={openCustomer} />;
      case "policies":
        return <PoliciesList onOpenPolicy={openPolicy} />;
      default:
        return <SectionPlaceholder label={SECTION_TITLE[activeSection]} />;
    }
  }

  return (
    <>
      <AppShell activeSection={activeSection} onNavigate={navigate}>
        {current ? renderDetail() : renderSection()}
      </AppShell>
      {/* Outside AppShell: the launcher and its modal are fixed to the viewport
          and must not sit inside the shell's blurred/scrolling layers. */}
      <FraudChat />
    </>
  );
}
