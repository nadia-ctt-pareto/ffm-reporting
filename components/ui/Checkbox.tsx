import type { ChangeEvent } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  /** WP3: optional passthrough for an admin-only control (e.g. McpAccessSection's org-read scope checkbox) that should be disabled-with-a-hint for a non-admin rather than hidden -- see CLAUDE.md's Phase 8c "disabled, not hidden" posture. Defaults `false` (every pre-WP3 call site is unaffected). */
  disabled?: boolean;
}

export function Checkbox({ label, checked, onChange, disabled = false }: CheckboxProps) {
  return (
    <label className={styles.wrap}>
      <input type="checkbox" className={styles.box} checked={checked} onChange={onChange} disabled={disabled} />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
