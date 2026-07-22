import Link from 'next/link';
import styles from './StatCard.module.css';

export interface StatCardProps {
  label: string;
  value: string;
  /**
   * Schedule view follow-up: optional navigation target. Strictly opt-in --
   * `undefined` renders the exact same `<div className={styles.card}>`
   * markup this component always has, so `ReportDeck.tsx`'s static
   * `StatCard` calls (which pass neither this) stay byte-identical, the
   * same additive-only contract `Table`'s `stacked`/`scrollX` props already
   * established (see CLAUDE.md). When set, the whole card becomes a
   * `<Link>` with a hover affordance and a visible focus ring instead of an
   * inert `<div>` -- used by the dashboard's "Avg. Tasks On Schedule" /
   * "Open Blockers (Latest)" and the report screen's "Tasks On Schedule" /
   * "Open Blockers" cards to jump into `/tasks`'s new Schedule tab
   * (optionally pre-filtered via `?filter=`).
   */
  href?: string;
}

export function StatCard({ label, value, href }: StatCardProps) {
  const content = (
    <>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${styles.card} ${styles.cardLink}`}>
        {content}
      </Link>
    );
  }

  return <div className={styles.card}>{content}</div>;
}
