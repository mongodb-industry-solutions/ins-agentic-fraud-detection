import Sidebar from "@/components/sidebar/Sidebar";
import Topbar from "@/components/topbar/Topbar";
import styles from "./AppShell.module.css";

export default function AppShell({ activeSection, onNavigate, children }) {
  return (
    <div className={styles.shell}>
      <div className={styles.backdrop} />
      <div className={styles.glow} />
      <Sidebar activeSection={activeSection} onNavigate={onNavigate} />
      <div className={styles.main}>
        <Topbar />
        {children}
      </div>
    </div>
  );
}
