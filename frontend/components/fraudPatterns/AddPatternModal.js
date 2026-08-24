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
import useEmbeddingInfo from "./useEmbeddingInfo";
import styles from "./AddPatternModal.module.css";
import panelStyles from "./PatternDetailModal.module.css";

export default function AddPatternModal({ open, onClose, onCreated }) {
  const basics = usePatternBasics();
  const [fullDescription, setFullDescription] = useState("");
  const [errors, setErrors] = useState({});
  // Saving a similarity pattern spends Voyage quota, so it is confirmed rather
  // than just done. The form is validated BEFORE the prompt appears: asking
  // someone to approve an external API call and then telling them a field was
  // empty wastes the decision they just made.
  const [isConfirming, setIsConfirming] = useState(false);
  const { model, dimensions } = useEmbeddingInfo("fraud_patterns", open);
  const { submit, isSaving, phase, saveError } = useCreatePattern(onCreated, {
    embedAfterCreate: true,
  });

  const handleRequestSave = () => {
    const nextErrors = validateBasics(basics);
    if (!fullDescription.trim()) {
      nextErrors.embeddingText = "The description is what gets embedded, so it can't be empty.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setIsConfirming(true);
  };

  const handleConfirmedSave = () => {
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
              On saving, this description is embedded so the pattern can be matched by narrative
              similarity. If that step fails the pattern is still created, and reads{" "}
              <code>Not available — pending embedding procedure</code> until it has been embedded.
            </div>
          </FormRow>
        </div>

        {isConfirming && (
          <div className={panelStyles.section}>
            <div className={styles.confirmBanner}>
              <Icon name="info" size={16} className={styles.confirmIcon} />
              <span>
                <span className={styles.confirmTitle}>
                  Saving this pattern will embed its description.
                </span>
                The description is sent to Voyage AI
                {model ? (
                  <>
                    {" "}
                    and embedded with <span className={styles.confirmModel}>{model}</span>
                    {dimensions ? ` (${dimensions} dimensions)` : ""}
                  </>
                ) : null}
                , which is what lets the fraud agent match new claims against it by narrative. This
                calls the Voyage API and counts against your quota.
                <span className={styles.confirmNote}>
                  If the embedding fails, the pattern is still saved and stays pending until it has
                  been embedded — nothing is lost.
                </span>
              </span>
            </div>
          </div>
        )}

        <div className={panelStyles.footer}>
          {isConfirming ? (
            <>
              <button
                type="button"
                className={panelStyles.btnSm}
                onClick={() => setIsConfirming(false)}
                disabled={isSaving}
              >
                Back
              </button>
              <button
                type="button"
                className={panelStyles.btnPrimary}
                onClick={handleConfirmedSave}
                disabled={isSaving}
              >
                {phase === "embedding"
                  ? "Embedding…"
                  : phase === "creating"
                    ? "Saving…"
                    : "Save and embed"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={panelStyles.btnSm} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={panelStyles.btnPrimary}
                onClick={handleRequestSave}
              >
                Save pattern
              </button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
