import AgentActivity from "@/components/agentActivity/AgentActivity";
import StatusBreakdown from "@/components/statusBreakdown/StatusBreakdown";
import styles from "./InsightsZone.module.css";

export default function InsightsZone({ breakdown, events }) {
  return (
    <section className={styles.zone} aria-label="Fraud status and activity">
      <StatusBreakdown breakdown={breakdown} />
      <div className={styles.divider}>
        <AgentActivity events={events} />
      </div>
    </section>
  );
}
