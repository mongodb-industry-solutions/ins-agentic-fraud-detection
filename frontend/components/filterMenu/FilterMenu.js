"use client";

import Icon from "@/components/icons/Icons";
import styles from "./FilterMenu.module.css";
import useFilterMenu from "./useFilterMenu";

/**
 * One dropdown: a chip trigger plus a single-select option list. Used for the
 * three filter chips and the sort control alike — they differ only in icon and
 * alignment, so they share one implementation.
 */
export default function FilterMenu({ control, icon = "chevronDown", align = "left", onSelect }) {
  const { isOpen, toggle, close, containerRef } = useFilterMenu();

  const choose = (optionId) => {
    onSelect(control.id, optionId);
    close();
  };

  return (
    <div className={styles.wrap} ref={containerRef}>
      <button
        type="button"
        className={`${styles.trigger} ${control.isActive ? styles.active : ""} ${
          isOpen ? styles.open : ""
        }`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {icon === "sortDesc" && <Icon name="sortDesc" size={12} />}
        {control.buttonLabel}
        <span className={styles.chevron}>
          <Icon name="chevronDown" size={12} />
        </span>
      </button>

      {isOpen && (
        <div
          className={`${styles.menu} ${align === "right" ? styles.alignRight : ""}`}
          role="listbox"
        >
          {control.options.map((option) => {
            const isSelected = option.id === control.selectedId;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`${styles.option} ${isSelected ? styles.selected : ""}`}
                onClick={() => choose(option.id)}
              >
                <span className={styles.tick}>
                  {isSelected && <Icon name="check" size={11} />}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
