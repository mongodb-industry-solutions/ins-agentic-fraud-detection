"use client";

import { useState } from "react";

import PageHeader from "@/components/pageHeader/PageHeader";
import TabBar from "@/components/tabBar/TabBar";
import { FI_TABS } from "@/lib/fraudIntelligencePresenter";
import styles from "./FraudIntelligenceView.module.css";
import CorrelationsTab from "./CorrelationsTab";
import OverviewTab from "./OverviewTab";
import PatternsTab from "./PatternsTab";
import RelationshipsTab from "./RelationshipsTab";

/**
 * The Fraud Intelligence section and its own internal tab bar.
 *
 * The six tabs are local component state, not a detailStack push and not a
 * route: switching between them never navigates away from this section, so the
 * sidebar keeps this entry highlighted throughout. Drilling into a claim from
 * inside one of these tabs is the thing that pushes onto detailStack, and that
 * is the caller's job — hence `onOpenClaim` being passed straight through.
 *
 * All four tabs are built. Operations and Activity were dropped rather than
 * left as placeholders — see FI_TABS.
 */
export default function FraudIntelligenceView({ onOpenClaim }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <main className={styles.content}>
      <PageHeader
        title="Fraud Intelligence"
        subtitle="Portfolio-wide analytics, relationships, and financial impact"
      />

      <TabBar
        tabs={FI_TABS}
        activeId={activeTab}
        onChange={setActiveTab}
        label="Fraud intelligence sections"
      />

      {activeTab === "overview" ? (
        <OverviewTab onOpenClaim={onOpenClaim} />
      ) : activeTab === "relationships" ? (
        <RelationshipsTab onOpenClaim={onOpenClaim} />
      ) : activeTab === "correlations" ? (
        <CorrelationsTab />
      ) : (
        <PatternsTab />
      )}
    </main>
  );
}
