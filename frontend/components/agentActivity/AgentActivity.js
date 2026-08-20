import Icon from "@/components/icons/Icons";
import ScoreChip from "@/components/scoreChip/ScoreChip";
import styles from "./AgentActivity.module.css";

/** The presenter hands over typed fragments; this maps each to an element. */
function Fragment({ part }) {
  if (part.type === "mono") return <span className={styles.mono}>{part.value}</span>;
  if (part.type === "score") return <ScoreChip value={part.value} />;
  return <>{part.value}</>;
}

export default function AgentActivity({ events }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Recent agent activity</span>
        <button type="button" className={styles.viewAll}>
          View all
        </button>
      </div>

      {events.map((event) => (
        <div key={event.id} className={styles.row}>
          <span className={`${styles.icon} ${styles[event.statusKey]}`}>
            <Icon name={event.icon} size={12} />
          </span>
          <div className={styles.text}>
            <span className={styles.sentence}>
              {event.parts.map((part, index) => (
                <Fragment key={index} part={part} />
              ))}
            </span>
            <span className={styles.timestamp}>{event.timestamp}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
