"use client";
import FraudReportContent from "@/components/fraudReport/FraudReportContent";
import { DEMO_FRAUD_REPORT } from "@/lib/const/demoFraudReport";
export default function Preview() {
  return <div style={{ maxWidth: 780, margin: "0 auto" }}>
    <FraudReportContent report={DEMO_FRAUD_REPORT} totalPatternsEvaluated={9}
      onClose={() => {}} onOpenClaim={() => {}} onDecide={async () => {}} />
  </div>;
}
