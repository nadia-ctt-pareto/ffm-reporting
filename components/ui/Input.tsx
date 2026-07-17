import type { ChangeEvent } from 'react';
import styles from './Input.module.css';

export interface InputProps {
  type?: 'text' | 'date' | 'number';
  label?: string;
  placeholder?: string;
  value: string | number;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
}

export function Input({ type = 'text', label, placeholder, value, onChange, readOnly = false }: InputProps) {
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
      />
    </label>
  );
}
