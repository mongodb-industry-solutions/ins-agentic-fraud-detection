"use client";

import { useState } from "react";

import PageHeader from "@/components/pageHeader/PageHeader";
import TabBar from "@/components/tabBar/TabBar";
import { FI_TABS } from "@/lib/fraudIntelligencePresenter";
import styles from "./FraudIntelligenceView.module.css";
import CorrelationsTab from "./CorrelationsTab";
import OverviewTab from "./OverviewTab";
import RelationshipsTab from "./RelationshipsTab";
import { EmptyState, Zone } from "./Zone";

/**
 * The Fraud Intelligence section and its own internal tab bar.
 *
 * The six tabs are local component state, not a detailStack push and not a
 * route: switching between them never navigates away from this section, so the
 * sidebar keeps this entry highlighted throughout. Drilling into a claim from
 * inside one of these tabs is the thing that pushes onto detailStack, and that
 * is the caller's job — hence `onOpenClaim` being passed straight through.
 *
 * Overview, Relationships and Correlations are built. Patterns renders an honest
 * note saying it is not, rather than a mocked-up version of itself.
 */
export default function FraudIntelligenceView({ onOpenClaim }) {
  const [activeTab, setActiveTab] = useState("overview");
  const activeLabel = FI_TABS.find((tab) => tab.id === activeTab)?.label || "";

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
        <div className={styles.tabBody}>
          <Zone title={activeLabel}>
            <EmptyState message={`The ${activeLabel} view is not built yet.`} />
          </Zone>
        </div>
      )}
    </main>
  );
}
