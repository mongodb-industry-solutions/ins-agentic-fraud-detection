"use client";

import Icon from "@/components/icons/Icons";
import Overlay from "@/components/shared/Overlay";
import styles from "./DemoReset.module.css";

const DELETED = ["Claims", "Customers", "Policies", "Assessments & queue", "Decisions & audit trail"];
const KEPT = ["Fraud patterns"];

/** The "are you sure" step: what is lost, what is kept, and that it cannot be undone. */
export default function ResetDialog({ open, database, onConfirm, onCancel }) {
  return (
    <Overlay open={open} onClose={onCancel} label="Reset the demo data">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.badge}>
            <Icon name="alert" size={24} />
          </div>
          <div>
            <h2 className={styles.title}>Reset the demo data?</h2>
            <p className={styles.lead}>
              This rewrites the <span className={styles.database}>{database}</span> database and
              starts the demo again from the beginning.
            </p>
          </div>
        </div>

        <div className={styles.groups}>
          <section className={`${styles.group} ${styles.groupDeleted}`}>
            <h3 className={styles.groupTitle}>
              <Icon name="close" size={14} />
              Deleted and replaced with the original data
            </h3>
            <ul className={styles.list}>
              {DELETED.map((item) => (
                <li key={item}>
                  <Icon name="close" size={14} className={styles.listIcon} />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className={`${styles.group} ${styles.groupKept}`}>
            <h3 className={styles.groupTitle}>
              <Icon name="check" size={14} />
              Not affected
            </h3>
            <ul className={styles.list}>
              {KEPT.map((item) => (
                <li key={item}>
                  <Icon name="check" size={14} className={styles.listIcon} />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className={styles.notice}>
          <Icon name="info" size={16} className={styles.noticeIcon} />
          <span>
            Every decision made during this demo will be lost. This cannot be undone. A reset is not
            possible while an assessment is running.
          </span>
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} onClick={onConfirm} autoFocus>
            Reset demo data
          </button>
        </div>
      </div>
    </Overlay>
  );
}
