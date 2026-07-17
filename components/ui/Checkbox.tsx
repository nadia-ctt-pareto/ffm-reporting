import type { ChangeEvent } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return (
    <label className={styles.wrap}>
      <input type="checkbox" className={styles.box} checked={checked} onChange={onChange} />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
