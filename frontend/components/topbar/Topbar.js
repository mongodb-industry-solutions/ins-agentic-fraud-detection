"use client";

import { useTheme } from "@/app/providers";
import Icon from "@/components/icons/Icons";
import ProfileMenu from "./ProfileMenu";
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
        <ProfileMenu />
      </div>
    </header>
  );
}
