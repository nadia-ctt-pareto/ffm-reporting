'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from 'radix-ui';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Switch } from '@/components/ui/Switch';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  href: string;
  label: string;
}

// Phase 3 scope: Dashboard, Tasks (List/Kanban), Calendar (Week/Month).
// /daily/* is a later phase -- don't add a nav item for it yet.
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/calendar', label: 'Calendar' },
];

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

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
              <span className={styles.navIcon} aria-hidden="true" />
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

      <div className={styles.footer}>
        {!collapsed ? (
          <Switch label="Dark Mode" checked={theme === 'dark'} onChange={(next) => setTheme(next ? 'dark' : 'light')} />
        ) : (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle Dark Mode"
            aria-label="Toggle Dark Mode"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
        )}
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
