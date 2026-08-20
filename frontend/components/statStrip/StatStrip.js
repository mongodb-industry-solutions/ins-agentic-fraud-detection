import Icon from "@/components/icons/Icons";
import Sparkline from "@/components/sparkline/Sparkline";
import styles from "./StatStrip.module.css";

export default function StatStrip({ stats }) {
  return (
    <section className={styles.strip} aria-label="Portfolio metrics">
      {stats.map((stat) => (
        <div key={stat.id} className={styles.column}>
          <div className={styles.head}>
            <span className={`${styles.chip} ${styles[stat.statusKey]}`}>
              <Icon name={stat.icon} size={13} />
            </span>
            <span className={styles.label}>{stat.label}</span>
          </div>
          <div className={styles.body}>
            <span className={styles.value}>{stat.value}</span>
            {stat.delta ? (
              <span className={styles.delta}>
                <span className={styles.arrow}>▲</span>
                {stat.delta}
              </span>
            ) : (
              <Sparkline points={stat.sparkline?.points} tone={stat.sparkline?.tone} />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
