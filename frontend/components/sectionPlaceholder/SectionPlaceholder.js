import styles from "./SectionPlaceholder.module.css";

/**
 * Stands in for the sidebar sections that have no screen yet. Explicitly empty
 * rather than silently falling back to the Dashboard, which would make the
 * nav look broken.
 */
export default function SectionPlaceholder({ label }) {
  return (
    <main className={styles.content}>
      <div className={styles.zone}>
        <span className={styles.title}>{label}</span>
        <span className={styles.body}>
          This section hasn&apos;t been built yet. Any claim it references will open the claim
          view, and the back link will return here.
        </span>
      </div>
    </main>
  );
}
