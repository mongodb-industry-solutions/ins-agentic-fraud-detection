import styles from "./Badge.module.css";

export default function Badge({ label }) {
  return <span className={styles.badge}>{label}</span>;
}
