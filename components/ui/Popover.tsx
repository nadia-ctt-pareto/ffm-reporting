'use client';

import type { ReactNode } from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import styles from './Popover.module.css';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

/**
 * Rebuilt on Radix Popover (headless), 100% styled by our own CSS. Used by
 * the Calendar month grid's "+N more" day-overflow disclosure -- headless
 * behavior (focus management, dismiss-on-outside-click/Escape, positioning
 * that stays in-viewport) with the same square-cornered card look as
 * `Select`'s content/`Dialog`'s panel.
 */
export function Popover({ trigger, children, align = 'start' }: PopoverProps) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content className={styles.content} align={align} sideOffset={6}>
          {children}
          <RadixPopover.Arrow className={styles.arrow} />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
