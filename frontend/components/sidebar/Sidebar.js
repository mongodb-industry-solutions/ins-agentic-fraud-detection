"use client";

import Icon from "@/components/icons/Icons";
import { ACTIVE_NAV_ID, SYSTEM_NAV, WORKSPACE_NAV } from "@/lib/const/nav";
import styles from "./Sidebar.module.css";

function NavItem({ item }) {
  const isActive = item.id === ACTIVE_NAV_ID;
  return (
    <button
      type="button"
      className={`${styles.item} ${isActive ? styles.active : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={styles.icon}>
        <Icon name={item.icon} />
      </span>
      {item.label}
    </button>
  );
}

export default function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.mark}>L</span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>Leafy Claim Manager</span>
          <span className={styles.brandSub}>Fraud detection &amp; claims</span>
        </span>
      </div>

      <p className={styles.groupLabel}>Workspace</p>
      <div className={styles.group}>
        {WORKSPACE_NAV.map((item) => (
          <NavItem key={item.id} item={item} />
        ))}
      </div>

      {/* Flex spacer pins the System group to the bottom of the sidebar. */}
      <div className={styles.spacer} />

      <p className={styles.groupLabel}>System</p>
      <div className={styles.group}>
        {SYSTEM_NAV.map((item) => (
          <NavItem key={item.id} item={item} />
        ))}
      </div>
    </nav>
  );
}
