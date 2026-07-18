'use client';

import type { ReactNode } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import styles from './Tabs.module.css';

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  value: string;
  /** Radix's onValueChange convention: receives the selected value directly, matching Select/Switch (see CLAUDE.md). */
  onChange: (value: string) => void;
  items: TabItem[];
  'aria-label': string;
}

/**
 * Rebuilt on Radix Tabs (headless), styled as a square-cornered segmented
 * control -- the List/Kanban toggle (Task view) and Week/Month toggle
 * (Calendar view) both use it. Each `TabItem.content` is rendered inside a
 * Radix `Tabs.Content` panel, which Radix leaves unmounted while inactive
 * (no `forceMount`), so e.g. the Kanban board's `DndContext` only ever
 * mounts while that tab is selected.
 */
export function Tabs({ value, onChange, items, 'aria-label': ariaLabel }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} className={styles.root}>
      <RadixTabs.List className={styles.list} aria-label={ariaLabel}>
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} className={styles.trigger}>
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className={styles.content}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
