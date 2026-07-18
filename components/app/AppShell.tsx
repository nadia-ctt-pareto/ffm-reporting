'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from 'radix-ui';
import { Sidebar } from '@/components/app/Sidebar';
import styles from './AppShell.module.css';

const COLLAPSE_KEY = 'ff.sidebar-collapsed';

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Sidebar + content grid shared by every route in the (shell) route group.
 * Collapse state persists to localStorage['ff.sidebar-collapsed']; the
 * initial render always assumes expanded (matching the server) and syncs
 * from localStorage in an effect after mount, for the same hydration-safety
 * reason as ThemeProvider.
 */
export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed, hydrated]);

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
        <main className={styles.main}>{children}</main>
      </div>
    </Tooltip.Provider>
  );
}
