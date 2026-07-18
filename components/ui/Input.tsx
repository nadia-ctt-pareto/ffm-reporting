'use client';

import type { ChangeEvent } from 'react';
import { useId } from 'react';
import styles from './Input.module.css';

export interface InputProps {
  type?: 'text' | 'date' | 'number';
  label?: string;
  placeholder?: string;
  value: string | number;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
  /**
   * Phase 6a: optional autocomplete suggestions, rendered as a native
   * `<datalist>` wired to the input via the `list` attribute. Used by the
   * wizard's Client fields (StepTasks/StepRisks) to suggest known project
   * names -- a plain `Input`, not a `Select`, so any free-text client name
   * still works (see lib/projects.ts). Native datalist popups are
   * browser-styled, not design-system-token-styled -- an accepted
   * trade-off for Phase 6a (a custom Popover combobox is a later nicety).
   */
  suggestions?: string[];
}

export function Input({ type = 'text', label, placeholder, value, onChange, readOnly = false, suggestions }: InputProps) {
  const datalistId = useId();
  return (
    <label className={styles.field}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <input
        className={styles.input}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        list={suggestions && suggestions.length > 0 ? datalistId : undefined}
      />
      {suggestions && suggestions.length > 0 ? (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
