'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import { Sidebar } from '@/components/app/Sidebar';
import { MobileNav } from '@/components/app/MobileNav';
import { IconMenu } from '@/components/ui/icons';
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
 *
 * Mobile P2: below 768px the desktop rail (`.desktopSidebar`) is hidden by
 * CSS and a sticky mobile top bar (hamburger + brand) takes its place,
 * opening the same <Sidebar> in an off-canvas <MobileNav> drawer.
 * `drawerOpen` is genuine client-only interaction state -- useState(false),
 * no persistence, no SSR mismatch (server and first client render both
 * start closed).
 */
export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

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

  // Belt-and-braces: Sidebar's own onNavigate already closes the drawer on
  // nav-item click, but this covers any other navigation (e.g. browser
  // back/forward) while the drawer happens to be open.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Mobile P2 follow-up: rotating a tablet to landscape, or resizing a
  // desktop window past 768px, while the drawer is open left it stuck
  // open -- the hamburger (and the whole mobile top bar) disappears at
  // >=768px (AppShell.module.css), but the drawer's own open/closed state
  // is independent React state, so nothing else was closing it. This is
  // state, not layout, so a `matchMedia` listener doesn't run afoul of
  // CLAUDE.md's no-JS-layout-branching rule (no styles are computed here).
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
        <div className={styles.desktopSidebar}>
          <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
        </div>
        <header className={styles.topBar}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <IconMenu className={styles.menuIcon} aria-hidden="true" />
          </button>
          <div className={styles.topBarBrand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand logo, matches Sidebar.tsx's identical exemption */}
            <img src="/logo-horizontal.svg" alt="Foundation First Marketing" className={styles.topBarLogo} />
            <span className={styles.topBarWordmark}>Weekly Reports</span>
          </div>
        </header>
        <MobileNav open={drawerOpen} onOpenChange={setDrawerOpen} />
        <main className={styles.main}>{children}</main>
      </div>
    </Tooltip.Provider>
  );
}
