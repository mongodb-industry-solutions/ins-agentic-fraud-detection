"use client";

import { useState } from "react";

import Icon from "@/components/icons/Icons";
import Overlay from "@/components/shared/Overlay";
import { PATTERN_TYPE } from "@/lib/fraudPatternsPresenter";
import {
  FormRow,
  PatternBasicsSections,
  toBasicsPayload,
  usePatternBasics,
  validateBasics,
} from "./FormFields";
import useCreatePattern from "./useCreatePattern";
import styles from "./AddPatternModal.module.css";
import panelStyles from "./PatternDetailModal.module.css";

export default function AddPatternModal({ open, onClose, onCreated }) {
  const basics = usePatternBasics();
  const [fullDescription, setFullDescription] = useState("");
  const [errors, setErrors] = useState({});
  const { submit, isSaving, saveError } = useCreatePattern(onCreated);

  const handleSave = () => {
    const nextErrors = validateBasics(basics);
    if (!fullDescription.trim()) {
      nextErrors.embeddingText = "The description is what gets embedded, so it can't be empty.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    submit({
      patternType: PATTERN_TYPE.SIMILARITY,
      ...toBasicsPayload(basics),
      // This text IS the pattern — it is what gets embedded and compared
      // against claim narratives, so it goes to embeddingText, not description.
      embeddingText: fullDescription.trim(),
    });
  };

  return (
    <Overlay open={open} onClose={onClose} variant="centered" label="New pattern">
      <div className={panelStyles.panel}>
        <div className={panelStyles.header}>
          <span className={panelStyles.title}>New pattern</span>
          <button type="button" className={panelStyles.closeBtn} onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>

        {saveError && (
          <div className={panelStyles.section}>
            <div className={styles.formError}>Couldn&apos;t create this pattern: {saveError}</div>
          </div>
        )}

        <PatternBasicsSections
          basics={basics}
          namePlaceholder="e.g. Staged rear-end collision narrative"
          errors={errors}
        />

        {/* Where this form diverges from the rule form: no condition builder,
            because a similarity pattern is matched by narrative, not by field
            comparison. The one description field IS the pattern. */}
        <div className={panelStyles.section}>
          <FormRow label="Full description" required>
            <textarea
              className={`${styles.formTextarea} ${styles.tall}`}
              value={fullDescription}
              placeholder="Describe the fraud narrative in full, natural language — this text is what gets embedded and compared against new claim narratives via similarity search."
              aria-invalid={Boolean(errors.embeddingText)}
              onChange={(event) => setFullDescription(event.target.value)}
            />
            {errors.embeddingText && (
              <div className={styles.fieldError}>{errors.embeddingText}</div>
            )}
            <div className={styles.formHintBox}>
              After saving, this pattern appears immediately but reads{" "}
              <code>Not available — pending embedding procedure</code> until its embedding has been
              generated. It takes no part in similarity matching until then.
            </div>
          </FormRow>
        </div>

        <div className={panelStyles.footer}>
          <button
            type="button"
            className={panelStyles.btnSm}
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={panelStyles.btnPrimary}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save pattern"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
