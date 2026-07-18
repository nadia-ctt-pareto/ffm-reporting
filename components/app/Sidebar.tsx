'use client';

import type { ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import { IconCalendar, IconDaily, IconDashboard, IconSettings, IconTasks } from '@/components/ui/icons';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Phase 3: Dashboard, Tasks (List/Kanban), Calendar (Week/Month).
// Phase 4: Daily Reports (/daily).
// Phase 5: Settings (/settings) + hand-authored square icons (see components/ui/icons.tsx).
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: IconDashboard },
  { href: '/daily', label: 'Daily Reports', icon: IconDaily },
  { href: '/tasks', label: 'Tasks', icon: IconTasks },
  { href: '/calendar', label: 'Calendar', icon: IconCalendar },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
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

      {/* Phase 5: theme control moved to /settings -- this footer is now
          just the collapse toggle (the Dark Mode Switch/sun-moon button
          that used to live here is gone, along with the useTheme import). */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '« Collapse'}
        </button>
      </div>
    </aside>
  );
}
