"use client";

import { useState } from "react";

import Icon from "@/components/icons/Icons";
import Overlay from "@/components/shared/Overlay";
import { PATTERN_TYPE } from "@/lib/fraudPatternsPresenter";
import ConditionBuilder, { EMPTY_CONDITION } from "./ConditionBuilder";
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

export default function AddRuleModal({ open, onClose, onCreated }) {
  const basics = usePatternBasics();
  const [conditions, setConditions] = useState([{ ...EMPTY_CONDITION }]);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const { submit, isSaving, saveError } = useCreatePattern(onCreated);

  const handleSave = () => {
    const nextErrors = validateBasics(basics);
    // Every condition has to be complete: a row with an empty value would be
    // stored as a comparison against nothing.
    const filled = conditions.filter((condition) => String(condition.value).trim() !== "");
    if (filled.length !== conditions.length) {
      nextErrors.conditions = "Every condition needs a value — remove any row you don't need.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    submit({
      patternType: PATTERN_TYPE.RULE,
      ...toBasicsPayload(basics),
      description: description.trim(),
      conditions: filled.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: String(condition.value).trim(),
      })),
    });
  };

  return (
    <Overlay open={open} onClose={onClose} variant="centered" label="New rule">
      <div className={panelStyles.panel}>
        <div className={panelStyles.header}>
          <span className={panelStyles.title}>New rule</span>
          <button type="button" className={panelStyles.closeBtn} onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>

        {saveError && (
          <div className={panelStyles.section}>
            <div className={styles.formError}>Couldn&apos;t create this rule: {saveError}</div>
          </div>
        )}

        <PatternBasicsSections
          basics={basics}
          namePlaceholder="e.g. No police report filed"
          errors={errors}
        />

        <div className={panelStyles.section}>
          <FormRow label="Conditions" required hint="all combined with AND">
            <ConditionBuilder conditions={conditions} onChange={setConditions} />
            {errors.conditions && <div className={styles.fieldError}>{errors.conditions}</div>}
          </FormRow>
        </div>

        <div className={panelStyles.section}>
          <FormRow label="Description" hint="internal only, not used for semantic search">
            <textarea
              className={styles.formTextarea}
              value={description}
              placeholder="Explain why this rule matters, for whoever reviews it next."
              onChange={(event) => setDescription(event.target.value)}
            />
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
            {isSaving ? "Saving…" : "Save rule"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
