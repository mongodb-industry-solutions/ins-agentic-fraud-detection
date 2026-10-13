import styles from "./TabBar.module.css";

/**
 * The underlined tab strip, extracted from ClaimView so the claim view and the
 * fraud intelligence section are literally the same component rather than two
 * copies of the same CSS that can drift apart.
 *
 * Purely presentational: it reports which tab was clicked and renders which one
 * is active. Whether switching a tab means showing already-fetched content (the
 * claim view) or mounting a whole sub-view (fraud intelligence) is the caller's
 * business, not this component's.
 */
export default function TabBar({ tabs, activeId, onChange, label = "Sections" }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={`${styles.tab} ${tab.id === activeId ? styles.activeTab : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
