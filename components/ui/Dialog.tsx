'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width: number;
  children: ReactNode;
}

// Module-level stack of open dialogs so only the topmost one reacts to Escape.
// Dialogs can stack — e.g. Share opens on top of the still-mounted Detail dialog,
// and a single Escape should dismiss only the overlay on top.
const dialogStack: symbol[] = [];

export function Dialog({ open, onClose, title, width, children }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    dialogStack.push(id);

    // Move focus into the dialog on open; restore it to the trigger on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dialogStack[dialogStack.length - 1] === id) {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const idx = dialogStack.indexOf(id);
      if (idx !== -1) dialogStack.splice(idx, 1);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div id={titleId} className={styles.title}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
