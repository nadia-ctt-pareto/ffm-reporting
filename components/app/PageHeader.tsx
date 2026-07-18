import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
}

/**
 * Phase 5: the shared route header -- title left, actions right, the same
 * bottom-border treatment every route header already had. Supersedes the
 * per-screen `.header`/`.brand`/`.logo`/`.wordmark` blocks in
 * `DashboardScreen`/`DailyListScreen` (and their duplicated brand logo +
 * "Weekly Reports" wordmark, which now lives only in the sidebar).
 *
 * Deliberate deviation from a pure actions-only bar: `title` stays a plain
 * page title ("Dashboard", "Daily Reports", ...) rather than disappearing
 * entirely -- an actions-only floating row reads as disoriented, and the
 * duplication complaint was about the brand wordmark, not page titles.
 */
export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.title}>{title}</span>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
