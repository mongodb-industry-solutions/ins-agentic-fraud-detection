import styles from "./ClaimAudit.module.css";

export default function ClaimAudit({ entries, isProcessed }) {
  if (entries.length === 0) {
    return (
      <div className={styles.zone}>
        {/* A scored claim with no records is a storage gap, not a claim waiting
            to be analyzed — telling the reader to analyze it would be wrong. */}
        <p className={styles.empty}>
          {isProcessed
            ? "This claim has been scored, but no fraud-review record was stored for it."
            : "No agent runs yet — analyze this claim to start building its audit trail."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.zone}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        return (
          <div key={entry.id} className={styles.entry}>
            <div className={styles.rail}>
              <span className={entry.isAgentRun ? styles.agentDot : styles.eventDot} />
              {!isLast && <span className={styles.line} />}
            </div>
            <div className={isLast ? styles.lastBody : styles.body}>
              <div className={styles.head}>
                <span className={styles.title}>{entry.title}</span>
                <span className={styles.timestamp}>{entry.timestampLabel}</span>
              </div>
              {entry.details.map((detail) => (
                <span key={detail} className={styles.detail}>
                  {detail}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
