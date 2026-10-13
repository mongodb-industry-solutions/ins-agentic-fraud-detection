import PendingAssessment from "@/components/pendingAssessment/PendingAssessment";
import StatusBreakdown from "@/components/statusBreakdown/StatusBreakdown";
import styles from "./InsightsZone.module.css";

export default function InsightsZone({ breakdown, pendingAssessment, onAnalyze, onViewDetails }) {
  return (
    <section className={styles.zone} aria-label="Fraud status and pending assessment">
      <StatusBreakdown breakdown={breakdown} />
      <div className={styles.divider}>
        <PendingAssessment
          rows={pendingAssessment}
          onAnalyze={onAnalyze}
          onViewDetails={onViewDetails}
        />
      </div>
    </section>
  );
}
