"use client";

import { useEffect, useRef, useState } from "react";

import { useDemoResetControl } from "@/components/demoReset/DemoResetProvider";
import Icon from "@/components/icons/Icons";
import { PROFILE } from "@/lib/const/nav";
import menuStyles from "./ProfileMenu.module.css";
import styles from "./Topbar.module.css";

/**
 * The profile chip. When the backend offers a demo reset it opens a small menu
 * holding that action: out of the way during a demo, but two deliberate clicks
 * from a reset (menu item, then the confirmation). The dialog itself belongs to
 * DemoResetProvider.
 */
export default function ProfileMenu() {
  const { available, isResetting, requestReset } = useDemoResetControl();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={menuStyles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.profile}
        onClick={() => available && setIsOpen((open) => !open)}
        aria-haspopup={available ? "menu" : undefined}
        aria-expanded={available ? isOpen : undefined}
      >
        <span className={styles.avatar}>{PROFILE.initials}</span>
        <span className={styles.profileText}>
          <span className={styles.profileName}>{PROFILE.name}</span>
          <span className={styles.profileTeam}>{PROFILE.team}</span>
        </span>
        {available && (
          <Icon
            name="chevronDown"
            size={14}
            className={`${menuStyles.chevron} ${isOpen ? menuStyles.chevronOpen : ""}`}
          />
        )}
      </button>

      {available && isOpen && (
        <div className={menuStyles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={menuStyles.resetItem}
            disabled={isResetting}
            onClick={() => {
              setIsOpen(false);
              requestReset();
            }}
          >
            <Icon name="reset" size={16} className={menuStyles.resetIcon} />
            <span className={menuStyles.resetText}>
              <span className={menuStyles.resetLabel}>Reset demo data</span>
              <span className={menuStyles.resetHint}>Start the demo over from the beginning</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
