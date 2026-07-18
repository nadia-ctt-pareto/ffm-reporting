'use client';

import { useId } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';
import styles from './Switch.module.css';

export interface SwitchProps {
  label: string;
  checked: boolean;
  /** Radix's onCheckedChange convention: receives the next checked state directly. */
  onChange: (checked: boolean) => void;
}

/** Drop-in a11y upgrade over the old hand-rolled checkbox-as-switch: same visuals, rebuilt on Radix Switch. */
export function Switch({ label, checked, onChange }: SwitchProps) {
  const labelId = useId();
  return (
    <label className={styles.wrap}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      {/* Radix Switch renders a <button>; tie its accessible name to the
          visible label instead of relying on the wrapping <label>. */}
      <RadixSwitch.Root
        className={styles.track}
        checked={checked}
        onCheckedChange={onChange}
        aria-labelledby={labelId}
      >
        <RadixSwitch.Thumb className={styles.thumb} />
      </RadixSwitch.Root>
    </label>
  );
}
