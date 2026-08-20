import FactGrid from "@/components/factGrid/FactGrid";
import styles from "./ClaimCustomer.module.css";

/* Live/current values. These can legitimately disagree with the Overview
   tab's claim-time snapshot block — that is correct, not a data bug. */
export default function ClaimCustomer({ customer }) {
  return (
    <div className={styles.zone}>
      <div className={styles.header}>
        <span className={styles.title}>Customer</span>
        <span className={styles.caption}>— live values, current as of today</span>
      </div>
      <FactGrid cells={customer.cells} />
    </div>
  );
}
