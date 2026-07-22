'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort, nowDate } from '@/lib/format';
import { attentionTasks } from '@/lib/needs-attention';
import { reportPeriodEnd, reportPeriodLabel, statusTone, taskTone } from '@/lib/report-utils';
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

const ATTENTION_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/**
 * Caps the Needs Attention table so a heavy week doesn't turn Home into an
 * endless scroll (CLAUDE.md's decided cap) -- the "+N more" link below the
 * table always reflects the TRUE remaining count, not a rounded/approximate
 * one.
 */
const ATTENTION_LIMIT = 8;

/**
 * `/` -- a light, read-only landing overview (nav IA restructure). The weekly
 * list it used to be now lives at `/reports` (`DashboardScreen`). Everything
 * here is a pure derivation over the two report lists: at-a-glance counts (open
 * tasks via the existing `lib/view-utils` selectors), an actionable Needs
 * Attention list (see below), and the most-recent few reports across both
 * kinds, each linking to its real report route. Quick-create actions live in
 * the header. No filter/sort/pagination state -- `HomePage` is a thin
 * orchestrator, this screen is presentational.
 *
 * **Needs Attention**: every Blocked/In Progress task across BOTH weeklies
 * AND dailies (`lib/needs-attention.ts`'s `attentionTasks` -- unlike `/tasks`,
 * which stays weekly-only, see CLAUDE.md "Task and Calendar views (Phase 3)"),
 * capped at `ATTENTION_LIMIT` with a "+N more" link into `/tasks` that always
 * reports the TRUE remaining count. Clicking a row navigates to that task's
 * parent report (`Table`'s `onRowClick`, reused rather than hand-rolled --
 * see Table.tsx's own doc comment on why a nested link would need to stop
 * its own click from bubbling, which isn't needed here since the whole row
 * IS the single navigation target). The `attentionRemaining` "+N more" link
 * points at plain `/tasks` (not `/tasks?view=schedule`) -- the section
 * header's own link is the `?view=schedule` one. Note `/tasks` itself stays
 * weekly-only (see CLAUDE.md), so a daily-only task past the cap won't
 * literally appear there -- same pre-existing, documented gap as `/tasks`
 * and `/calendar` not surfacing dailies at all (CLAUDE.md's own "Dailies
 * aren't surfaced here yet" note); `/tasks` is still the closest existing
 * "see everything" destination, and this is not a new problem this feature
 * introduces.
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

  // "Today" is read once, on mount -- same precedent CalendarScreen/
  // TaskScheduleView already use (`useState(() => nowDate())`). Safe here
  // for the same reason: HomePage already gates this screen's render on
  // both report lists having loaded, so this never runs on the very first
  // paint.
  const [today] = useState(() => nowDate());
  const attention = useMemo(() => attentionTasks(weeklies, dailies, today), [weeklies, dailies, today]);
  const attentionShown = attention.slice(0, ATTENTION_LIMIT);
  const attentionRemaining = attention.length - attentionShown.length;

  const attentionRows = attentionShown.map((entry) => ({
    client: entry.task.client,
    task: entry.task.task,
    status: <Badge tone={taskTone(entry.task.status)}>{entry.task.status}</Badge>,
    deadline: (
      <span className={styles.deadlineCell}>
        {fmtDateShort(entry.task.deadline)}
        {entry.overdue ? <span className={styles.overdueMarker}>Overdue</span> : null}
      </span>
    ),
  }));

  function goToAttentionEntry(index: number) {
    const entry = attentionShown[index];
    router.push(entry.report.kind === 'weekly' ? `/reports/${entry.report.id}` : `/daily/${entry.report.id}`);
  }

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
          <div className={styles.sectionHeaderRow}>
            <div className={styles.sectionKicker}>Needs Attention</div>
            <Link href="/tasks?view=schedule" className={styles.sectionLink}>
              View Task Schedule
            </Link>
          </div>
          {attention.length === 0 ? (
            <div className={styles.emptyState}>
              Nothing needs attention right now — no task across your weekly or daily reports is currently Blocked or In
              Progress.
            </div>
          ) : (
            <>
              <Table columns={ATTENTION_COLUMNS} rows={attentionRows} stacked onRowClick={goToAttentionEntry} />
              {attentionRemaining > 0 ? (
                <Link href="/tasks" className={styles.moreLink}>
                  +{attentionRemaining} more
                </Link>
              ) : null}
            </>
          )}
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
