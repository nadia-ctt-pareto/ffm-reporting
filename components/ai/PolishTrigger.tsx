'use client';

// The in-field half of the polish affordance -- an icon-only button living
// INSIDE the trailing edge of the field it polishes, contributing ZERO
// height to that field's own layout (see PolishTrigger.module.css's
// `.trigger` comment). Its sibling half, the suggestion/error panel, is
// `PolishPanel.tsx` -- both read from the SAME `usePolishField` state (see
// that hook's own header comment for why they must never each call the
// hook independently).

import { IconPolish } from '@/components/ui/icons';
import type { PolishFieldState } from './usePolishField';
import styles from './PolishTrigger.module.css';

export interface PolishTriggerProps {
  state: PolishFieldState;
  /**
   * `'input'` (default) vertically centers the button against a
   * `components/ui/Input.tsx` field's fixed 42px input box, ignoring any
   * label text rendered above it in the same wrapper -- see
   * PolishTrigger.module.css's `.anchorInput` comment. `'textarea'`
   * anchors top-right instead: a `Textarea` has no fixed height (it grows,
   * and is user-resizable), so vertical centering isn't meaningful there --
   * see `.anchorTextarea`'s own comment.
   */
  anchor?: 'input' | 'textarea';
}

export function PolishTrigger({ state, anchor = 'input' }: PolishTriggerProps) {
  if (state.status !== 'configured') return null;
  const { phase, isDisabled, spec, trigger } = state;
  const anchorClass = anchor === 'textarea' ? styles.anchorTextarea : styles.anchorInput;
  const label = phase === 'busy' ? `Polishing ${spec.label.toLowerCase()}…` : `Polish ${spec.label.toLowerCase()}`;

  return (
    <button
      type="button"
      className={`${styles.trigger} ${anchorClass}`}
      disabled={isDisabled}
      aria-busy={phase === 'busy'}
      aria-label={label}
      title={label}
      onClick={trigger}
    >
      <IconPolish width={14} height={14} aria-hidden />
    </button>
  );
}
