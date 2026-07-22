'use client';

import { useEffect, useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import {
  IconCalendar,
  IconChevron,
  IconConsolidate,
  IconDaily,
  IconDashboard,
  IconHome,
  IconMyWeek,
  IconReports,
  IconSettings,
  IconSignOut,
  IconTasks,
} from '@/components/ui/icons';
import { useSession } from '@/lib/hooks/useSession';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from './Sidebar.module.css';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Mobile P2: invoked from each nav Link's onClick. MobileNav passes this
      to close the drawer on navigation; the desktop rail leaves it unset. */
  onNavigate?: () => void;
  /** Mobile P2: MobileNav passes `false` -- collapsing is meaningless inside
      an off-canvas drawer that's already only rendered when fully open.
      Defaults to `true` so every existing (desktop) call site is unchanged. */
  showCollapseToggle?: boolean;
  /** Mobile P2 follow-up: MobileNav passes `'drawer'` so the sidebar fills
      its off-canvas panel (`height: 100%`) instead of the viewport
      (`height: 100vh`) -- see Sidebar.module.css's `.drawer` doc comment.
      Defaults to `'rail'` so the desktop call site is unchanged. */
  variant?: 'rail' | 'drawer';
}

interface NavLeaf {
  href: string;
  label: string;
  icon: IconType;
}

interface NavGroup {
  label: string;
  icon: IconType;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

// Nav IA restructure: Home overview at `/`; the weekly list moved to
// `/reports`. "Reports" is a collapsible group nesting Weekly (the old
// dashboard, keeping IconDashboard), Daily, and Tasks. Projects left the
// sidebar entirely -- it now lives as a Settings tab (`/settings?tab=projects`).
// WP6: "My Week" (a personal digest + PDF export over the merged task set,
// see lib/my-week.ts) sits right after Home -- both are personal overview
// screens, as opposed to the Reports group's per-record browsing.
const NAV_ENTRIES: NavEntry[] = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/my-week', label: 'My Week', icon: IconMyWeek },
  {
    label: 'Reports',
    icon: IconReports,
    children: [
      { href: '/reports', label: 'Weekly', icon: IconDashboard },
      { href: '/daily', label: 'Daily', icon: IconDaily },
      { href: '/tasks', label: 'Tasks', icon: IconTasks },
    ],
  },
  { href: '/calendar', label: 'Calendar', icon: IconCalendar },
  { href: '/consolidate', label: 'Consolidate', icon: IconConsolidate },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

const REPORTS_OPEN_KEY = 'ff.nav-reports-open';

/**
 * Active-nav matching. `/` is matched EXACTLY (every path starts with `/`, so
 * a prefix match would light Home on every route). Every other href matches
 * itself or any descendant, so `/reports/[id]` lights "Weekly", `/daily/[id]`
 * lights "Daily", etc. -- the codebase had no prefix-matching helper before
 * this (see the nav IA restructure notes in CLAUDE.md).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ collapsed, onToggleCollapse, onNavigate, showCollapseToggle = true, variant = 'rail' }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useSession();
  const configured = isSupabaseConfigured();

  // Whether any collapsible group has an active child -- used to auto-open the
  // group so the current location is always visible. Only "Reports" is a group
  // today; kept generic so a second group needs no new state.
  const reportsGroup = NAV_ENTRIES.find((e): e is NavGroup => isGroup(e)) ?? null;
  const reportsActive = reportsGroup ? reportsGroup.children.some((c) => isActive(pathname, c.href)) : false;

  const [reportsOpen, setReportsOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Sync open/closed from localStorage after mount (hydration-safe: server and
  // first client render both start `true`, matching the pre-hydration DOM),
  // mirroring AppShell's `collapsed` persistence.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REPORTS_OPEN_KEY);
      if (stored !== null) setReportsOpen(stored === '1');
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(REPORTS_OPEN_KEY, reportsOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [reportsOpen, hydrated]);

  // `reportsOpen` is the *persisted* user preference (toggled by the button,
  // saved above). The *displayed* state also opens whenever a child route is
  // active, so the current location is always visible -- but WITHOUT rewriting
  // the stored preference (auto-revealing on every report visit must not
  // permanently clobber a deliberate collapse). Only an explicit toggle changes
  // `reportsOpen`; this derived value never persists.
  const showReports = reportsOpen || reportsActive;

  const handleSignOut = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    router.push('/login');
  };

  // One nav Link (icon + label), wrapped in a Tooltip only when the rail is
  // icon-collapsed. `indented` marks a group child in the expanded rail.
  function renderLeaf(leaf: NavLeaf, indented: boolean): ReactNode {
    const active = isActive(pathname, leaf.href);
    const link = (
      <Link
        href={leaf.href}
        className={`${styles.navItem} ${indented ? styles.navChild : ''} ${active ? styles.navItemActive : ''}`}
        aria-label={collapsed ? leaf.label : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        <leaf.icon className={styles.navIcon} aria-hidden="true" />
        {!collapsed ? <span className={styles.navLabel}>{leaf.label}</span> : null}
      </Link>
    );
    if (!collapsed) return <div key={leaf.href}>{link}</div>;
    return (
      <Tooltip.Root key={leaf.href}>
        <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltip} side="right" sideOffset={8}>
            {leaf.label}
            <Tooltip.Arrow className={styles.tooltipArrow} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${variant === 'drawer' ? styles.drawer : ''}`}>
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand logo, next/image adds no value here */}
        <img src="/logo-horizontal.svg" alt="Foundation First Marketing" className={styles.logo} />
        {!collapsed ? <span className={styles.wordmark}>Weekly Reports</span> : null}
      </div>

      <nav className={styles.nav}>
        {NAV_ENTRIES.map((entry) => {
          if (!isGroup(entry)) return renderLeaf(entry, false);

          // Icon-collapsed rail: flatten the group to its child icons (no
          // disclosure fits an 18px rail), so the rail is icon-only exactly
          // like before this change.
          if (collapsed) {
            return <div key={entry.label} className={styles.navGroupFlat}>{entry.children.map((child) => renderLeaf(child, false))}</div>;
          }

          return (
            <div key={entry.label} className={styles.navGroup}>
              <button
                type="button"
                className={styles.navGroupToggle}
                aria-expanded={showReports}
                aria-controls="nav-group-reports"
                onClick={() => setReportsOpen((v) => !v)}
              >
                <entry.icon className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>{entry.label}</span>
                <IconChevron className={`${styles.navChevron} ${showReports ? styles.navChevronOpen : ''}`} aria-hidden="true" />
              </button>
              {showReports ? (
                <div id="nav-group-reports" className={styles.navGroupChildren}>
                  {entry.children.map((child) => renderLeaf(child, true))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Phase 5: theme control moved to /settings -- this footer was just
          the collapse toggle (the Dark Mode Switch/sun-moon button that
          used to live here is gone, along with the useTheme import). Phase
          7a adds the signed-in session block below it, rendered only when
          isSupabaseConfigured() -- demo mode's footer is unchanged.
          `loading` (useSession) reserves this block's layout space with an
          empty placeholder while `auth.getUser()` is still resolving, so
          the session row doesn't visibly pop in a beat after first paint. */}
      <div className={styles.footer}>
        {configured && loading ? <div className={styles.session} aria-hidden="true" /> : null}
        {configured && !loading && user ? (
          collapsed ? (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button type="button" className={styles.footerAction} onClick={handleSignOut} aria-label={`Sign out (${user.email})`}>
                  <IconSignOut className={styles.navIcon} aria-hidden="true" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} side="right" sideOffset={8}>
                  Sign out ({user.email})
                  <Tooltip.Arrow className={styles.tooltipArrow} />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ) : (
            <div className={styles.session}>
              <span className={styles.sessionEmail} title={user.email}>
                {user.email}
              </span>
              <button type="button" className={styles.footerAction} onClick={handleSignOut}>
                <IconSignOut className={styles.navIcon} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          )
        ) : null}
        {showCollapseToggle ? (
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '»' : '« Collapse'}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
