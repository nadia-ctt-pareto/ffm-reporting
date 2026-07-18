'use client';

import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui';
import type { ReactNode } from 'react';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width: number;
  children: ReactNode;
}

/**
 * Rebuilt on Radix Dialog (Root/Portal/Overlay/Content/Title), 100% styled
 * by Dialog.module.css. Keeps the exact {open,onClose,title,width,children}
 * API every call site already used, so this was a zero call-site-churn
 * swap. Radix's own layered DismissableLayer replaces the old hand-rolled
 * `dialogStack` module/focus-trap: nested dialogs (e.g. Share opened on top
 * of Detail) dismiss top-first with a single Escape, natively, and focus is
 * trapped/restored automatically.
 */
export function Dialog({ open, onClose, title, width, children }: DialogProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.panel} style={{ width }}>
          <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
          {/* Radix requires a Description (or an explicit opt-out) for a11y;
              we don't have per-call-site description copy, so provide a
              visually-hidden one derived from the title to satisfy
              aria-describedby without changing the visible layout. */}
          <RadixDialog.Description asChild>
            <VisuallyHidden.Root>{title || 'Dialog'}</VisuallyHidden.Root>
          </RadixDialog.Description>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
