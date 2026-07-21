'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { reportPeriodEnd, reportPeriodLabel, statusTone } from '@/lib/report-utils';
import type { AnyReport, DailyReport, Report } from '@/lib/types';
import { allTasks, groupTasksByStatus } from '@/lib/view-utils';
import styles from './HomeScreen.module.css';

export interface HomeScreenProps {
  /** Weeklies (Report = WeeklyReport, see lib/types.ts). */
  weeklies: Report[];
  dailies: DailyReport[];
}

const RECENT_COLUMNS: TableColumn[] = [
  { key: 'kind', label: 'Type' },
  { key: 'period', label: 'Period' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

const RECENT_LIMIT = 6;

/**
 * `/` -- a light, read-only landing overview (nav IA restructure). The weekly
 * list it used to be now lives at `/reports` (`DashboardScreen`). Everything
 * here is a pure derivation over the two report lists: at-a-glance counts (open
 * tasks via the existing `lib/view-utils` selectors) and the most-recent few
 * reports across both kinds, each linking to its real report route. Quick-create
 * actions live in the header. No filter/sort/pagination state -- `HomePage`
 * is a thin orchestrator, this screen is presentational.
 */
export function HomeScreen({ weeklies, dailies }: HomeScreenProps) {
  const router = useRouter();

  const grouped = groupTasksByStatus(allTasks(weeklies));
  const openTasks = grouped.Blocked.length + grouped['In Progress'].length;
  const blocked = grouped.Blocked.length;

  const recent: AnyReport[] = [...weeklies, ...dailies]
    .sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)))
    .slice(0, RECENT_LIMIT);

  const recentRows = recent.map((r) => ({
    kind: r.kind === 'weekly' ? 'Weekly' : 'Daily',
    period: reportPeriodLabel(r),
    status: <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
    actions: (
      <Link href={r.kind === 'weekly' ? `/reports/${r.id}` : `/daily/${r.id}`} className={styles.rowAction}>
        View
      </Link>
    ),
  }));

  return (
    <div>
      <PageHeader
        title="Home"
        actions={
          <>
            <Button variant="outline" size="md" onClick={() => router.push('/daily/new')}>
              New Daily Report
            </Button>
            <Button variant="primary" size="md" onClick={() => router.push('/reports/new')}>
              New Weekly Report
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <StatCard label="Weekly Reports" value={String(weeklies.length)} />
          <StatCard label="Daily Reports" value={String(dailies.length)} />
          <StatCard label="Open Tasks" value={String(openTasks)} />
          <StatCard label="Blocked Tasks" value={String(blocked)} />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionKicker}>Recent Reports</div>
          {recent.length === 0 ? (
            <div className={styles.emptyState}>No reports yet. Create your first weekly or daily report above.</div>
          ) : (
            <Table columns={RECENT_COLUMNS} rows={recentRows} stacked />
          )}
        </div>
      </div>
    </div>
  );
}
