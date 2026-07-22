'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import { DemoModeBanner } from '@/components/app/DemoModeBanner';
import { Sidebar } from '@/components/app/Sidebar';
import { MobileNav } from '@/components/app/MobileNav';
import { IconMenu } from '@/components/ui/icons';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
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

  // WP1: the session-bootstrap call for the verified-email team-directory
  // self-link (see supabase/migrations/20260726000016_team_members.sql's
  // `public.link_my_team_member()` doc comment for the full design). This
  // layout wraps every route in the `(shell)` group and is mounted once per
  // full page load (a Next.js layout doesn't remount on navigation within
  // it), which is exactly "once per sign-in session" for this app's actual
  // usage pattern -- a better fit than any individual page. Fire-and-forget
  // on purpose: this is a convenience (nothing in this app currently reads
  // `team_members.user_id`), not a gate, so a failure is swallowed rather
  // than surfaced anywhere -- see that RPC's own doc comment for why
  // repeated/failed calls are always harmless (idempotent by construction).
  // Demo mode has no session/RPC to call at all. Every request that reaches
  // this layout has already passed `middleware.ts`'s Supabase-mode
  // authenticated-route redirect, so a signed-in user is expected to
  // already be present by the time this effect runs -- this is NOT what
  // decides whether the caller is signed in; the RPC itself degrades to a
  // harmless no-op (`auth.uid()` reads NULL, its own guard returns early)
  // if it somehow ran unauthenticated anyway.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    // `.rpc()` returns a thenable `PostgrestFilterBuilder`, not a real
    // `Promise` -- it has no `.catch()` of its own (TS2551) -- so this
    // wraps it in `Promise.resolve()` first, purely to get a real Promise
    // to attach `.catch()` to.
    Promise.resolve(getSupabaseBrowserClient().rpc('link_my_team_member')).catch(() => {
      // Best-effort only -- see the comment above.
    });
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
        <main className={styles.main}>
          <DemoModeBanner />
          {children}
        </main>
      </div>
    </Tooltip.Provider>
  );
}
