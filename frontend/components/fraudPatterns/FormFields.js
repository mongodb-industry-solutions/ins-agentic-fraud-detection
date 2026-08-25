"use client";

import { useState } from "react";

import {
  CLAIM_TYPE_OPTIONS,
  COVERAGE_TYPE_OPTIONS,
  SEVERITY_OPTIONS,
} from "@/lib/fraudPatternsPresenter";
import { humanizeEnum } from "@/lib/claimsPresenter";
import styles from "./AddPatternModal.module.css";
import panelStyles from "./PatternDetailModal.module.css";

export function FormRow({ label, required, hint, children }) {
  return (
    <div className={styles.formRow}>
      <label className={styles.formLabel}>
        {label} {required && <span className={styles.req}>*</span>}
        {hint && <span className={styles.hintInline}> ({hint})</span>}
      </label>
      {children}
    </div>
  );
}

export function CheckChipGroup({ options, selected, onToggle }) {
  return (
    <div className={styles.checkboxGrid}>
      {options.map((option) => (
        <label
          key={option}
          className={`${styles.checkChip} ${selected.includes(option) ? styles.checked : ""}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={() => onToggle(option)}
          />
          {humanizeEnum(option)}
        </label>
      ))}
    </div>
  );
}

/**
 * The fields both add-forms carry identically: name, weight, severity and the
 * two appliesTo vocabularies. Only what comes after them differs — a condition
 * builder for a rule, a narrative description for a similarity pattern — so
 * these live in one place rather than being written out twice.
 */
export function usePatternBasics() {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [claimTypes, setClaimTypes] = useState([]);
  const [coverageTypes, setCoverageTypes] = useState([]);

  const toggle = (values, setValues) => (value) =>
    setValues(
      values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
    );

  return {
    name,
    setName,
    weight,
    setWeight,
    severity,
    setSeverity,
    claimTypes,
    coverageTypes,
    toggleClaimType: toggle(claimTypes, setClaimTypes),
    toggleCoverageType: toggle(coverageTypes, setCoverageTypes),
  };
}

const MAX_WEIGHT = 12;

/**
 * The rules the create endpoint enforces, checked here first so a form is not
 * submitted to be rejected. Keyed by field so each message lands next to the
 * control it is about.
 */
export function validateBasics(basics) {
  const errors = {};
  if (!basics.name.trim()) errors.name = "A pattern needs a name.";

  const weight = Number(basics.weight);
  if (basics.weight === "" || Number.isNaN(weight)) {
    errors.weight = "Weight is required and must be a number.";
  } else if (weight < 0 || weight > MAX_WEIGHT) {
    errors.weight = `Weight must be between 0 and ${MAX_WEIGHT} — a claim's fraud score caps at ${MAX_WEIGHT}.`;
  }

  // Both lists are required server-side: a pattern that applies to nothing can
  // never fire, so an empty selection is a mistake, not a wildcard.
  if (basics.claimTypes.length === 0) errors.claimTypes = "Pick at least one claim type.";
  if (basics.coverageTypes.length === 0) {
    errors.coverageTypes = "Pick at least one coverage type.";
  }
  return errors;
}

/** The half of the create payload both pattern types share. */
export function toBasicsPayload(basics) {
  return {
    name: basics.name.trim(),
    severity: basics.severity,
    weight: Number(basics.weight),
    appliesTo: {
      claimTypes: basics.claimTypes,
      coverageTypes: basics.coverageTypes,
    },
  };
}

export function PatternBasicsSections({ basics, namePlaceholder, errors = {} }) {
  return (
    <>
      <div className={panelStyles.section}>
        <FormRow label="Name" required>
          <input
            className={styles.formInput}
            value={basics.name}
            placeholder={namePlaceholder}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => basics.setName(event.target.value)}
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
            value={basics.weight}
            placeholder="e.g. 3"
            aria-invalid={Boolean(errors.weight)}
            onChange={(event) => basics.setWeight(event.target.value)}
          />
          {errors.weight && <div className={styles.fieldError}>{errors.weight}</div>}
        </FormRow>
        <FormRow label="Severity" hint="descriptive only — does not affect scoring">
          <select
            className={`${styles.formSelect} ${styles.medium}`}
            value={basics.severity}
            onChange={(event) => basics.setSeverity(event.target.value)}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {humanizeEnum(option)}
              </option>
            ))}
          </select>
        </FormRow>
      </div>

      <div className={panelStyles.section}>
        <FormRow label="Applies to — claim types" required>
          <CheckChipGroup
            options={CLAIM_TYPE_OPTIONS}
            selected={basics.claimTypes}
            onToggle={basics.toggleClaimType}
          />
          {errors.claimTypes && <div className={styles.fieldError}>{errors.claimTypes}</div>}
        </FormRow>
        <FormRow label="Applies to — coverage types" required>
          <CheckChipGroup
            options={COVERAGE_TYPE_OPTIONS}
            selected={basics.coverageTypes}
            onToggle={basics.toggleCoverageType}
          />
          {errors.coverageTypes && <div className={styles.fieldError}>{errors.coverageTypes}</div>}
        </FormRow>
      </div>
    </>
  );
}
