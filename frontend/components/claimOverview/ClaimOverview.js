"use client";

import FactGrid from "@/components/factGrid/FactGrid";
import styles from "./ClaimOverview.module.css";

export default function ClaimOverview({
  sections,
  isEditing,
  drafts,
  onDraftChange,
  onSave,
  onCancelEdit,
}) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.id} className={styles.section}>
          <div className={styles.header}>
            <span className={styles.title}>{section.title}</span>
            {section.caption && <span className={styles.caption}>{section.caption}</span>}
          </div>
          <FactGrid
            cells={section.cells}
            isEditing={isEditing}
            drafts={drafts}
            onDraftChange={onDraftChange}
          />
        </div>
      ))}

      {isEditing && (
        <div className={styles.saveBar}>
          <button type="button" className={styles.saveButton} onClick={onSave}>
            Save changes
          </button>
          <button type="button" className={styles.cancelButton} onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
