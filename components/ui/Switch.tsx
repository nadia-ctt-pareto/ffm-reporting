import type { ChangeEvent } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <label className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.track} ${checked ? styles.trackOn : ''}`}>
        <input type="checkbox" className={styles.input} checked={checked} onChange={onChange} />
        <span className={`${styles.thumb} ${checked ? styles.thumbOn : ''}`} />
      </span>
    </label>
  );
}
