"use client";

import { useMemo, useState } from "react";

import Icon from "@/components/icons/Icons";
import { humanizeEnum } from "@/lib/claimsPresenter";
import { updateFraudPattern } from "@/lib/api/fraudPatterns";
import { PATTERN_TYPE, SEVERITY_OPTIONS } from "@/lib/fraudPatternsPresenter";
import { FormRow } from "./FormFields";
import styles from "./AddPatternModal.module.css";
import panelStyles from "./PatternDetailModal.module.css";

const MAX_WEIGHT = 12;

/** Only what the caller actually changed, which is what a PATCH is for. */
function changedFields(values, initial) {
  const changed = {};
  if (values.name.trim() !== initial.name) changed.name = values.name.trim();
  if (values.severity !== initial.severity) changed.severity = values.severity;
  if (values.description.trim() !== initial.description) {
    changed.description = values.description.trim();
  }
  if (Number(values.weight) !== initial.weight) changed.weight = Number(values.weight);
  return changed;
}

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "A pattern needs a name.";

  const weight = Number(values.weight);
  if (values.weight === "" || Number.isNaN(weight)) {
    errors.weight = "Weight is required and must be a number.";
  } else if (weight < 0 || weight > MAX_WEIGHT) {
    // The same bound the endpoint enforces, stated before the round trip
    // rather than after it.
    errors.weight = `Weight must be between 0 and ${MAX_WEIGHT} — a claim's fraud score caps at ${MAX_WEIGHT}.`;
  }
  return errors;
}

/**
 * Edits the four fields update_fraud_pattern accepts: name, weight, severity
 * and the internal description. Everything that decides what a pattern
 * *matches* is shown read-only, because changing it would invalidate the
 * reliability stats already accumulated against the pattern (and, for a
 * similarity pattern, its embedding) — the endpoint rejects those fields, so
 * the form does not pretend to offer them.
 *
 * Renders inside the detail modal's panel, so the fetched detail is reused and
 * saving redraws it without a second request.
 */
export default function EditPatternForm({ detail, onCancel, onSaved }) {
  const initial = useMemo(
    () => ({
      name: detail.name,
      weight: detail.weight ?? 0,
      // A pattern with no stored severity would otherwise select nothing and
      // then silently save whatever the browser picked first.
      severity: SEVERITY_OPTIONS.includes(detail.severity) ? detail.severity : "MEDIUM",
      description: detail.description,
    }),
    [detail]
  );

  const [values, setValues] = useState({
    name: initial.name,
    weight: String(initial.weight),
    severity: initial.severity,
    description: initial.description,
  });
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value });

  const changed = changedFields(values, initial);
  const changedCount = Object.keys(changed).length;
  const isRule = detail.patternType === PATTERN_TYPE.RULE;

  const handleSave = async () => {
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Nothing changed: there is no request to make and nothing to report.
    if (changedCount === 0) {
      onCancel();
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await updateFraudPattern(detail.id, changed);
      onSaved(response.pattern, response.updatedFields);
    } catch (writeError) {
      setSaveError(writeError.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className={panelStyles.header}>
        <div className={panelStyles.titleRow}>
          <span className={panelStyles.title}>Edit pattern</span>
          <span className={panelStyles.badge}>{detail.id}</span>
          <span className={panelStyles.badge}>{detail.typeLabel}</span>
        </div>
        <button
          type="button"
          className={panelStyles.closeBtn}
          onClick={onCancel}
          aria-label="Cancel editing"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className={panelStyles.section}>
        {saveError && <div className={styles.formError}>Couldn&apos;t save: {saveError}</div>}

        <FormRow label="Name" required>
          <input
            className={styles.formInput}
            value={values.name}
            onChange={set("name")}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name && <div className={styles.fieldError}>{errors.name}</div>}
        </FormRow>

        <FormRow label="Weight (points)" required>
          <input
            className={`${styles.formInput} ${styles.narrow}`}
            type="number"
            min="0"
            max={MAX_WEIGHT}
            step="0.5"
            value={values.weight}
            onChange={set("weight")}
            aria-invalid={Boolean(errors.weight)}
          />
          {errors.weight && <div className={styles.fieldError}>{errors.weight}</div>}
        </FormRow>

        <FormRow label="Severity" hint="descriptive only — does not affect scoring">
          <select
            className={`${styles.formSelect} ${styles.medium}`}
            value={values.severity}
            onChange={set("severity")}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {humanizeEnum(option)}
              </option>
            ))}
          </select>
        </FormRow>

        <FormRow
          label="Description"
          hint={
            isRule
              ? "internal only, not used for semantic search"
              : "internal only — the embedded narrative is separate, below"
          }
        >
          <textarea
            className={styles.formTextarea}
            value={values.description}
            onChange={set("description")}
          />
        </FormRow>
      </div>

      {/* What the pattern matches: visible, so you can see what you are
          re-weighting, but not editable here. */}
      <div className={panelStyles.section}>
        <div className={panelStyles.sectionTitle}>
          {isRule ? "Conditions" : "Embedded narrative"}{" "}
          <span className={panelStyles.hint}>— not editable here</span>
        </div>
        <div className={styles.readOnlyBlock}>
          {isRule ? (
            detail.conditions.map((condition, index) => (
              <div key={`${condition.field}-${index}`} className={styles.readOnlyRow}>
                <span>{condition.field}</span>
                <span className={styles.readOnlyOp}>{condition.operator}</span>
                <span>{condition.value}</span>
              </div>
            ))
          ) : (
            <span>{detail.embeddingText}</span>
          )}
          <div className={styles.readOnlyNote}>
            {isRule
              ? "Changing what a rule matches would invalidate the reliability stats it has already accumulated, so it needs its own flow — update_fraud_pattern rejects ruleLogic."
              : "The narrative is what the embedding was generated from, so editing it requires re-embedding. update_fraud_pattern rejects embeddingText."}
          </div>
        </div>
      </div>

      <div className={panelStyles.section}>
        <div className={panelStyles.sectionTitle}>
          Applies to <span className={panelStyles.hint}>— not editable here</span>
        </div>
        <div className={styles.readOnlyBlock}>
          <div className={styles.readOnlyRow}>
            {[...detail.appliesTo.claimTypes, ...detail.appliesTo.coverageTypes].join(" · ")}
          </div>
          <div className={styles.readOnlyNote}>
            Narrowing or widening what a pattern applies to changes which claims it could have
            fired on, so it carries the same stats problem.
          </div>
        </div>
      </div>

      <div className={panelStyles.footer}>
        <button type="button" className={panelStyles.btnSm} onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button
          type="button"
          className={panelStyles.btnPrimary}
          onClick={handleSave}
          disabled={isSaving || changedCount === 0}
        >
          {isSaving
            ? "Saving…"
            : changedCount === 0
              ? "No changes"
              : `Save ${changedCount} change${changedCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </>
  );
}
