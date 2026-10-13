import Icon from "@/components/icons/Icons";
import Sparkline from "@/components/sparkline/Sparkline";
import styles from "./StatStrip.module.css";

export default function StatStrip({ stats }) {
  return (
    <section className={styles.strip} aria-label="Portfolio metrics">
      {stats.map((stat) => (
        <div key={stat.id} className={`${styles.column} ${styles[stat.tone]}`}>
          <div className={styles.head}>
            <span className={styles.chip}>
              <Icon name={stat.icon} size={16} />
            </span>
            <span className={styles.headText}>
              <span className={styles.label}>{stat.label}</span>
              <span className={styles.hint}>{stat.hint}</span>
            </span>
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

          <div className={styles.share}>
            {stat.bar && (
              <span className={styles.track}>
                {stat.bar.map((segment) => (
                  <span
                    key={segment.tone}
                    className={`${styles.fill} ${styles[`${segment.tone}Fill`]}`}
                    style={{ width: `${segment.pct}%` }}
                  />
                ))}
              </span>
            )}
            {stat.footnote && <span className={styles.shareLabel}>{stat.footnote}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
