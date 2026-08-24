import ScoreChip from "@/components/scoreChip/ScoreChip";
import StatusPill from "@/components/statusPill/StatusPill";
import styles from "./ClaimAudit.module.css";

/**
 * One matched pattern, with the evidence that fired it when the trace recorded
 * any. The comparison (`claimAmount=35000 > 25000`) is the part that makes an
 * audit trail auditable, so it is rendered as the value it is — mono — rather
 * than folded into prose.
 */
function PatternRow({ pattern }) {
  return (
    <div className={styles.patternRow}>
      <span className={styles.weight}>+{pattern.weight}</span>
      <div className={styles.patternBody}>
        <div className={styles.patternHead}>
          <span className={styles.patternName}>{pattern.name}</span>
          <span className={styles.patternId}>{pattern.patternId}</span>
          {pattern.typeLabel && <span className={styles.badge}>{pattern.typeLabel}</span>}
          {pattern.severity && <span className={styles.badge}>{pattern.severity}</span>}
        </div>
        {pattern.detail && (
          <span className={styles.evidence}>
            {pattern.detail}
            {pattern.similarityLabel && (
              <span className={styles.similarity}> · {pattern.similarityLabel} similar</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function AuditEntry({ entry, isLast }) {
  return (
    <div className={styles.entry}>
      <div className={styles.rail}>
        <span className={entry.isAgentRun ? styles.agentDot : styles.eventDot} />
        {!isLast && <span className={styles.line} />}
      </div>

      <div className={isLast ? styles.lastBody : styles.body}>
        <div className={styles.head}>
          <span className={styles.title}>{entry.title}</span>
          {/* The trace id is how this run is found in the database, so it earns
              a place in the record rather than being kept as an internal key. */}
          {entry.traceId && <span className={styles.traceId}>{entry.traceId}</span>}
          <span className={styles.headSpacer} />
          <span className={styles.timestamp}>{entry.timestampLabel}</span>
        </div>

        {entry.scoreLabel && (
          <div className={styles.scoreRow}>
            <ScoreChip value={entry.scoreLabel} size="large" />
            <div className={styles.scoreMeta}>
              <span className={styles.scoreOutOf}>{entry.scoreOutOf}</span>
              <span className={styles.scoreNotes}>
                {entry.bandLabel && <span className={styles.band}>{entry.bandLabel} band</span>}
                {entry.capNote && <span>{entry.capNote}</span>}
                <span>{entry.patternsNote}</span>
              </span>
            </div>
          </div>
        )}

        {entry.runFacts.length > 0 && (
          <div className={styles.facts}>
            {entry.runFacts.map((fact) => (
              <span key={fact.label} className={styles.fact}>
                <span className={styles.factLabel}>{fact.label}</span>
                <span className={fact.mono ? styles.factValueMono : styles.factValue}>
                  {fact.value}
                </span>
              </span>
            ))}
          </div>
        )}

        {entry.summary && <p className={styles.summary}>{entry.summary}</p>}

        {entry.patterns.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Patterns matched</span>
            {entry.patterns.map((pattern) => (
              <PatternRow key={pattern.patternId} pattern={pattern} />
            ))}
          </div>
        )}

        {/* The human verdict closes the run, so it reads as the last thing in
            the entry — and carries the same status pill the claim header uses,
            not a second vocabulary for the same four states. */}
        {entry.decision && (
          <div className={styles.decision}>
            <div className={styles.decisionHead}>
              <StatusPill statusKey={entry.decision.statusKey} label={entry.decision.label} />
              {entry.decision.siuReferred && <span className={styles.siuTag}>Referred to SIU</span>}
              <span className={styles.decisionBy}>
                {entry.decision.byLabel && <>by {entry.decision.byLabel}</>}
                {entry.decision.atLabel && (
                  <>
                    {" · "}
                    <span className={styles.mono}>{entry.decision.atLabel}</span>
                  </>
                )}
              </span>
            </div>
            {entry.decision.reasoning && (
              <p className={styles.reasoning}>{entry.decision.reasoning}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
      {entries.map((entry, index) => (
        <AuditEntry key={entry.id} entry={entry} isLast={index === entries.length - 1} />
      ))}
    </div>
  );
}
