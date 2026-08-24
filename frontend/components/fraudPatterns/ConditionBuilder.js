"use client";

import Icon from "@/components/icons/Icons";
import {
  CONDITION_FIELD_OPTIONS,
  CONDITION_OPERATOR_OPTIONS,
} from "@/lib/fraudPatternsPresenter";
import formStyles from "./AddPatternModal.module.css";
import styles from "./ConditionBuilder.module.css";

export const EMPTY_CONDITION = { field: "claimType", operator: "EQUALS", value: "" };

export default function ConditionBuilder({ conditions, onChange }) {
  const addRow = () => onChange([...conditions, { ...EMPTY_CONDITION }]);
  const removeRow = (index) => onChange(conditions.filter((_, i) => i !== index));
  const updateRow = (index, key, value) =>
    onChange(conditions.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <div>
      {conditions.map((condition, index) => (
        // Index-keyed on purpose: rows have no stable identity until saved, and
        // removal re-renders the whole list anyway.
        <div key={index} className={styles.condBuilderRow}>
          <select
            className={formStyles.formSelect}
            aria-label="Field"
            value={condition.field}
            onChange={(event) => updateRow(index, "field", event.target.value)}
          >
            {CONDITION_FIELD_OPTIONS.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
          <select
            className={formStyles.formSelect}
            aria-label="Operator"
            value={condition.operator}
            onChange={(event) => updateRow(index, "operator", event.target.value)}
          >
            {CONDITION_OPERATOR_OPTIONS.map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
          <input
            className={formStyles.formInput}
            value={condition.value}
            placeholder="value"
            aria-label="Value"
            onChange={(event) => updateRow(index, "value", event.target.value)}
          />
          {/* A rule must keep at least one condition, so the last row has no
              remove control rather than a disabled one. */}
          {conditions.length > 1 && (
            <button
              type="button"
              className={styles.condRemove}
              aria-label="Remove condition"
              onClick={() => removeRow(index)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      ))}

      <button type="button" className={styles.addConditionBtn} onClick={addRow}>
        <Icon name="plus" size={12} />
        Add condition
      </button>
    </div>
  );
}
