'use client';

import { useId } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import styles from './Select.module.css';

export type SelectOption = string | { value: string; label: string };

export interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  /**
   * Radix's onValueChange convention: receives the selected value directly
   * (not a ChangeEvent). See CLAUDE.md "Radix Select convention" -- every
   * call site was updated for this signature.
   */
  onChange: (value: string) => void;
  disabled?: boolean;
}

function normalize(option: SelectOption): { value: string; label: string } {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

/**
 * Rebuilt on Radix Select (headless listbox), styled 1:1 to the old native
 * <select>'s 42px square field: same font, same border/background tokens,
 * same height. Radix supplies focus management, keyboard nav (type-ahead,
 * arrows), and correct aria wiring for free.
 */
export function Select({ label, options, value, onChange, disabled = false }: SelectProps) {
  const normalized = options.map(normalize);
  const labelId = useId();
  return (
    <label className={styles.field}>
      {label ? (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      ) : null}
      <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
        {/* Radix Trigger is a <button>; a wrapping <label> doesn't name it the
            way it named the old native <select>, so tie it to the visible label. */}
        <RadixSelect.Trigger className={styles.trigger} aria-labelledby={label ? labelId : undefined}>
          <RadixSelect.Value />
          <RadixSelect.Icon className={styles.icon} aria-hidden="true">
            ▾
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
            <RadixSelect.Viewport className={styles.viewport}>
              {normalized.map((opt) => (
                <RadixSelect.Item key={opt.value} value={opt.value} className={styles.item}>
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </label>
  );
}
