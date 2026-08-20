"use client";

import Icon from "@/components/icons/Icons";
import styles from "./ClaimLinked.module.css";

export default function ClaimLinked({ linkedClaims, onOpenClaim }) {
  if (linkedClaims.length === 0) {
    return (
      <div className={styles.zone}>
        <p className={styles.empty}>No related claims found for this claim.</p>
      </div>
    );
  }

  return (
    <div className={styles.zone}>
      {linkedClaims.map((linked) => (
        <div key={linked.id} className={styles.row}>
          <span className={styles.numberChip}>{linked.numberLabel}</span>
          <div className={styles.body}>
            <div className={styles.head}>
              <span className={styles.customer}>{linked.customerName}</span>
              <span className={styles.claimId}>{linked.claimId}</span>
            </div>
            {linked.reasons.map((reason) => (
              <span key={reason.text} className={styles.reason}>
                <span className={styles.reasonIcon}>
                  <Icon name={reason.icon} size={12} />
                </span>
                {reason.text}
              </span>
            ))}
          </div>
          {/* The recursive entry point: claim view leads to claim view, using
              the same drilling mechanism as every other entry. */}
          <button
            type="button"
            className={styles.viewButton}
            onClick={() => onOpenClaim(linked.claimId)}
          >
            View
          </button>
        </div>
      ))}
    </div>
  );
}
