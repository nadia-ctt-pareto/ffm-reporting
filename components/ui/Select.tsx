import type { ChangeEvent } from 'react';
import styles from './Select.module.css';

export type SelectOption = string | { value: string; label: string };

export interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
}

function normalize(option: SelectOption): { value: string; label: string } {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

export function Select({ label, options, value, onChange, disabled = false }: SelectProps) {
  return (
    <label className={styles.field}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <select className={styles.select} value={value} onChange={onChange} disabled={disabled}>
        {options.map(normalize).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
