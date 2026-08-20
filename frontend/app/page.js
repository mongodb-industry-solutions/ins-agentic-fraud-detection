"use client";

import { useCallback, useState } from "react";

import AppShell from "@/components/appShell/AppShell";
import ClaimView from "@/components/claimView/ClaimView";
import Dashboard from "@/components/dashboard/Dashboard";
import SectionPlaceholder from "@/components/sectionPlaceholder/SectionPlaceholder";
import { SECTION_LABEL, SECTION_TITLE } from "@/lib/const/nav";

/**
 * The only route. Navigation is component state.
 *
 * `activeSection` is what the sidebar highlights and is never overwritten by
 * drilling into a claim. `activeClaimId` sits alongside it: when set, the claim
 * view renders in place of the section's normal content while the sidebar keeps
 * showing the section you came from. `returnSection` is captured at the moment
 * of drilling in, so Back returns to the true origin rather than assuming the
 * Dashboard.
 */
export default function Home() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [activeClaimId, setActiveClaimId] = useState(null);
  const [returnSection, setReturnSection] = useState(null);
  // Set only by the "Analyze for fraud" entry point, which exists to send
  // someone here specifically to trigger analysis.
  const [nudgeAnalyze, setNudgeAnalyze] = useState(false);

  const openClaim = useCallback(
    (claimId, options = {}) => {
      // Captured from whatever section is current, including when drilling from
      // one claim straight into another.
      setReturnSection((current) => current ?? activeSection);
      setActiveClaimId(claimId);
      setNudgeAnalyze(Boolean(options.analyze));
    },
    [activeSection]
  );

  // activeSection was never touched, so there is nothing to restore — only the
  // claim overlay state to remove.
  const closeClaim = useCallback(() => {
    setActiveClaimId(null);
    setReturnSection(null);
    setNudgeAnalyze(false);
  }, []);

  const navigate = useCallback((sectionId) => {
    setActiveSection(sectionId);
    setActiveClaimId(null);
    setReturnSection(null);
    setNudgeAnalyze(false);
  }, []);

  return (
    <AppShell activeSection={activeSection} onNavigate={navigate}>
      {activeClaimId ? (
        <ClaimView
          claimId={activeClaimId}
          backLabel={`Back to ${SECTION_LABEL[returnSection] || "claims"}`}
          onBack={closeClaim}
          onOpenClaim={openClaim}
          nudgeAnalyze={nudgeAnalyze}
        />
      ) : activeSection === "dashboard" ? (
        <Dashboard onOpenClaim={openClaim} />
      ) : (
        <SectionPlaceholder label={SECTION_TITLE[activeSection]} />
      )}
    </AppShell>
  );
}
