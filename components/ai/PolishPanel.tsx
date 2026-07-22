'use client';

// The suggestion/error half of the polish affordance. Rendered as a DIRECT
// child of whatever grid/flow container hosts the field it belongs to --
// see PolishPanel.module.css's `grid-column: 1 / -1` comment for why this
// component must NOT be nested inside the same wrapper `PolishTrigger`
// lives in. Reads from the SAME `usePolishField` state as its sibling
// `PolishTrigger` (see that hook's own header comment).

import { Button } from '@/components/ui/Button';
import { IconCheck } from '@/components/ui/icons';
import type { PolishFieldState } from './usePolishField';
import styles from './PolishPanel.module.css';

export interface PolishPanelProps {
  state: PolishFieldState;
}

export function PolishPanel({ state }: PolishPanelProps) {
  if (state.status !== 'configured') return null;
  const { phase, suggestion, errorMessage, accept, discard, undo, dismissError } = state;

  if (phase === 'suggested') {
    return (
      <div className={styles.panel} role="status" aria-live="polite">
        <div className={styles.panelLabel}>Suggested Rewrite</div>
        <p className={styles.suggestionText}>{suggestion}</p>
        <div className={styles.panelActions}>
          <Button variant="primary" size="sm" icon={<IconCheck width={14} height={14} aria-hidden />} onClick={accept}>
            Accept
          </Button>
          <Button variant="ghost" size="sm" onClick={discard}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'accepted') {
    return (
      <div className={styles.panel} role="status" aria-live="polite">
        <div className={styles.panelLabel}>Polished</div>
        <Button variant="ghost" size="sm" onClick={undo}>
          Undo
        </Button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.panelError} role="alert">
        <p className={styles.errorText}>{errorMessage}</p>
        <Button variant="ghost" size="sm" onClick={dismissError}>
          Dismiss
        </Button>
      </div>
    );
  }

  return null;
}
