"use client";

import ScoreChip from "@/components/scoreChip/ScoreChip";
import styles from "./PendingQueue.module.css";

export default function PendingQueue({ queue, onReview }) {
  return (
    <section className={styles.zone} aria-label="Pending your review">
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.pulseDot} />
          <span className={styles.title}>Pending your review</span>
        </div>
        <span className={styles.caption}>{queue.caption}</span>
      </div>

      {queue.items.map((item) => (
        <div key={item.id} className={styles.row}>
          <ScoreChip value={item.scoreLabel} size="large" />
          <div className={styles.info}>
            <div className={styles.infoTop}>
              <span className={styles.customer}>{item.customerName}</span>
              <span className={styles.claimId}>{item.claimId}</span>
            </div>
            <span className={styles.detail}>{item.detail}</span>
          </div>
          <div className={styles.tags}>
            {item.tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
            {item.overflowTag && <span className={styles.tag}>{item.overflowTag}</span>}
          </div>
          <button
            type="button"
            className={styles.reviewButton}
            onClick={() => onReview?.(item.claimId)}
          >
            Review
          </button>
        </div>
      ))}
    </section>
  );
}
