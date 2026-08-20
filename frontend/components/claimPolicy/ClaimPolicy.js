import CoveragesTable from "@/components/coveragesTable/CoveragesTable";
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

      {/* The same component Policy Detail renders — not a second copy. */}
      <CoveragesTable coverages={policy.coverages} />
    </>
  );
}
