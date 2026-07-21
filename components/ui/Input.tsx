'use client';

import type { ChangeEvent } from 'react';
import { useId } from 'react';
import styles from './Input.module.css';

export interface InputProps {
  /** Phase 7c: `'password'` added for AiKeySection's Anthropic-key entry field -- masks the value on screen while typing, same native behavior as any other password field (no design-system-specific styling needed). */
  type?: 'text' | 'date' | 'number' | 'email' | 'password';
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
  /** Phase 7a: plain HTML `autocomplete` passthrough -- e.g. `"email"` on LoginScreen's sole field (WCAG 2.1 AA 1.3.5, and lets the browser/password-manager offer a saved value). */
  autoComplete?: string;
  /** Phase 7a: passthrough for a field that should take focus on mount (e.g. the login page's email field). */
  autoFocus?: boolean;
  /** Phase 7a: plain HTML `required` passthrough. */
  required?: boolean;
}

export function Input({
  type = 'text',
  label,
  placeholder,
  value,
  onChange,
  readOnly = false,
  suggestions,
  autoComplete,
  autoFocus,
  required,
}: InputProps) {
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
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
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
