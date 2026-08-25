"use client";

import { useTheme } from "@/app/providers";
import Icon from "@/components/icons/Icons";
import { PROFILE } from "@/lib/const/nav";
import styles from "./Topbar.module.css";

export default function Topbar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className={styles.topbar}>
      <div />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
        </button>
        <button type="button" className={styles.profile}>
          <span className={styles.avatar}>{PROFILE.initials}</span>
          <span className={styles.profileText}>
            <span className={styles.profileName}>{PROFILE.name}</span>
            <span className={styles.profileTeam}>{PROFILE.team}</span>
          </span>
        </button>
      </div>
    </header>
  );
}
