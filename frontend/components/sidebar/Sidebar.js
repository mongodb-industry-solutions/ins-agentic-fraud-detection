"use client";

import Image from "next/image";
import Icon from "@/components/icons/Icons";
import { WORKSPACE_NAV, FRAUD_INTELLIGENCE_NAV } from "@/lib/const/nav";
import styles from "./Sidebar.module.css";

/**
 * The highlight is driven by activeSection alone — never by whether a claim
 * view happens to be showing. Drilling into a claim keeps its origin section
 * visually current, because that is still where you are.
 */
function NavItem({ item, isActive, onNavigate }) {
  return (
    <button
      type="button"
      className={`${styles.item} ${isActive ? styles.active : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onNavigate(item.id)}
    >
      <span className={styles.icon}>
        <Icon name={item.icon} />
      </span>
      {item.label}
    </button>
  );
}

export default function Sidebar({ activeSection, onNavigate }) {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Image
            src="/logo.png"
            alt="Fraud Intelligence Manager"
            width={32}
            height={32}
          />
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>Fraud Intelligence Manager</span>
          <span className={styles.brandSub}>Claims management & Agentic fraud detection</span>
        </span>
      </div>

      <p className={styles.groupLabel}>Workspace</p>
      <div className={styles.group}>
        {WORKSPACE_NAV.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={item.id === activeSection}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <p className={`${styles.groupLabel} ${styles.groupSpacing}`}>Fraud Intelligence</p>
      <div className={styles.group}>
        {FRAUD_INTELLIGENCE_NAV.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={item.id === activeSection}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </nav>
  );
}
