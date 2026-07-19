'use client';

import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui';
import { Sidebar } from '@/components/app/Sidebar';
import styles from './MobileNav.module.css';

export interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Off-canvas left drawer for <768px navigation. Reuses <Sidebar> verbatim
 * (nav items + session/Sign Out footer) so nav can never drift between the
 * desktop rail and the mobile drawer. Built directly on Radix Dialog parts
 * -- NOT components/ui/Dialog.tsx, whose API is a centered fixed-width
 * panel -- this is the canonical Radix "sheet" pattern: Escape/overlay-click
 * dismiss, focus trap + restore-to-trigger, scroll lock, and portal
 * layering all for free (no `modal={false}`, so none of that is opted out).
 * Sidebar's `onNavigate` closes the drawer on nav-item click;
 * `showCollapseToggle={false}` hides the (meaningless here) collapse
 * control -- `collapsed` is always false so the full sidebar renders.
 */
export function MobileNav({ open, onOpenChange }: MobileNavProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.panel}>
          {/* No visible dialog title/description UI here -- the Sidebar IS
              the content. Both are visually hidden but still wired for a11y
              (aria-labelledby/aria-describedby), same requirement Dialog.tsx
              satisfies for its own Description. */}
          <RadixDialog.Title asChild>
            <VisuallyHidden.Root>Navigation</VisuallyHidden.Root>
          </RadixDialog.Title>
          <RadixDialog.Description asChild>
            <VisuallyHidden.Root>Site navigation</VisuallyHidden.Root>
          </RadixDialog.Description>
          <Sidebar
            collapsed={false}
            onToggleCollapse={() => {}}
            showCollapseToggle={false}
            onNavigate={() => onOpenChange(false)}
            variant="drawer"
          />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
