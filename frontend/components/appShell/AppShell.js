import Sidebar from "@/components/sidebar/Sidebar";
import Topbar from "@/components/topbar/Topbar";
import styles from "./AppShell.module.css";

/** `rightPanel` is docked as a third column (the Fraud Assessment Queue). */
export default function AppShell({ activeSection, onNavigate, rightPanel, children }) {
  return (
    <div className={`${styles.shell} ${rightPanel ? styles.withRightPanel : ""}`}>
      <div className={styles.backdrop} />
      <div className={styles.glow} />
      <Sidebar activeSection={activeSection} onNavigate={onNavigate} />
      <div className={styles.main}>
        <Topbar />
        {children}
      </div>
      {rightPanel}
    </div>
  );
}
