"use client";

import FilterMenu from "@/components/filterMenu/FilterMenu";
import styles from "./FilterRow.module.css";

export default function FilterRow({
  controls,
  sortControl,
  showClear,
  onFilterChange,
  onSortChange,
  onClear,
}) {
  return (
    <div className={styles.row}>
      {controls.map((control) => (
        <FilterMenu key={control.id} control={control} onSelect={onFilterChange} />
      ))}

      {showClear && (
        <button type="button" className={styles.clear} onClick={onClear}>
          Clear filters
        </button>
      )}

      <span className={styles.spacer} />

      <FilterMenu
        control={sortControl}
        icon="sortDesc"
        align="right"
        onSelect={(_, optionId) => onSortChange(optionId)}
      />
    </div>
  );
}
