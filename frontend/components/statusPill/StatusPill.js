import { STATUS, STATUS_LABEL } from "@/lib/claimsPresenter";
import styles from "./StatusPill.module.css";

export default function StatusPill({ statusKey, label }) {
  const text = label || STATUS_LABEL[statusKey];
  return (
    <span className={`${styles.pill} ${styles[statusKey]}`}>
      {statusKey === STATUS.UNPROCESSED && <span className={styles.dot} />}
      {text}
    </span>
  );
}
