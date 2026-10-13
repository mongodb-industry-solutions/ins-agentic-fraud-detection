import styles from "./ScoreChip.module.css";

export default function ScoreChip({ value, size = "small" }) {
  if (value === null || value === undefined) {
    return <span className={styles.empty}>—</span>;
  }
  return (
    <span className={`${styles.chip} ${size === "large" ? styles.large : ""}`}>{value}</span>
  );
}
