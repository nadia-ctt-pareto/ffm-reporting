'use client';

import type { ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import { IconCalendar, IconConsolidate, IconDaily, IconDashboard, IconSettings, IconSignOut, IconTasks } from '@/components/ui/icons';
import { useSession } from '@/lib/hooks/useSession';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from './Sidebar.module.css';

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
      (`min-height: 100vh`) -- see Sidebar.module.css's `.drawer` doc
      comment. Defaults to `'rail'` so the desktop call site is unchanged. */
  variant?: 'rail' | 'drawer';
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Phase 3: Dashboard, Tasks (List/Kanban), Calendar (Week/Month).
// Phase 4: Daily Reports (/daily).
// Phase 5: Settings (/settings) + hand-authored square icons (see components/ui/icons.tsx).
// Phase 6b: Consolidate (/consolidate).
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: IconDashboard },
  { href: '/daily', label: 'Daily Reports', icon: IconDaily },
  { href: '/tasks', label: 'Tasks', icon: IconTasks },
  { href: '/calendar', label: 'Calendar', icon: IconCalendar },
  { href: '/consolidate', label: 'Consolidate', icon: IconConsolidate },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function Sidebar({ collapsed, onToggleCollapse, onNavigate, showCollapseToggle = true, variant = 'rail' }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useSession();
  const configured = isSupabaseConfigured();

  const handleSignOut = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    router.push('/login');
  };

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${variant === 'drawer' ? styles.drawer : ''}`}>
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand logo, next/image adds no value here */}
        <img src="/logo-horizontal.svg" alt="Foundation First Marketing" className={styles.logo} />
        {!collapsed ? <span className={styles.wordmark}>Weekly Reports</span> : null}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const link = (
            <Link
              href={item.href}
              className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
              aria-label={collapsed ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
            >
              <item.icon className={styles.navIcon} aria-hidden="true" />
              {!collapsed ? <span className={styles.navLabel}>{item.label}</span> : null}
            </Link>
          );
          if (!collapsed) return <div key={item.href}>{link}</div>;
          return (
            <Tooltip.Root key={item.href}>
              <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} side="right" sideOffset={8}>
                  {item.label}
                  <Tooltip.Arrow className={styles.tooltipArrow} />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
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
