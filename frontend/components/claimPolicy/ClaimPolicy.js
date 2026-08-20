import FactGrid from "@/components/factGrid/FactGrid";
import styles from "./ClaimPolicy.module.css";

/* Read-only in this phase: no edit affordance anywhere on this tab. */
export default function ClaimPolicy({ policy }) {
  return (
    <>
      <div className={styles.zone}>
        <span className={styles.sectionTitle}>Policy</span>
        <FactGrid cells={policy.cells} />
      </div>

      <div className={styles.zone}>
        <span className={styles.sectionTitle}>Coverage lines</span>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.headerCell}>Coverage</th>
              <th className={styles.numericHeader}>Limit</th>
              <th className={styles.numericHeader}>Deductible</th>
              <th className={styles.numericHeader}>Annual premium</th>
            </tr>
          </thead>
          <tbody>
            {policy.coverages.map((coverage) => (
              <tr key={coverage.id} className={styles.row}>
                <td className={styles.cell}>{coverage.name}</td>
                <td className={styles.numericCell}>{coverage.limit}</td>
                <td className={styles.numericCell}>{coverage.deductible}</td>
                <td className={styles.numericCell}>{coverage.premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
