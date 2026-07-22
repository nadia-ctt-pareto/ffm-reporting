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
import { groupMergedTasksByStatus } from '@/lib/task-merge';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { AnyReport, DailyReport, Report } from '@/lib/types';
import styles from './HomeScreen.module.css';

export interface HomeScreenProps {
  /** Weeklies (Report = WeeklyReport, see lib/types.ts). */
  weeklies: Report[];
  dailies: DailyReport[];
  /**
   * WP4 (the access flip's task-surface follow-up): the ONE shared merged
   * task set (`mergeTaskSources`, lib/task-merge.ts), built once by
   * `HomePage` from `weeklies` + `dailies` + the viewer's own
   * assigned-elsewhere tasks. Both the stat cards (Open/Blocked) and Needs
   * Attention derive from THIS, not from `weeklies` alone -- keeping them
   * consistent with each other (pre-WP4, the stat cards silently only ever
   * counted weekly tasks while Needs Attention already counted weekly+daily
   * -- an inconsistency this fixes as a side effect of sharing one set).
   */
  mergedTasks: MergedTaskEntry[];
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
  { key: 'actions', label: '', align: 'right', isAction: true },
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
 * here is a pure derivation: at-a-glance counts (open tasks via the shared
 * `mergedTasks`, WP4), an actionable Needs Attention list (see below), and
 * the most-recent few reports across both kinds, each linking to its real
 * report route. Quick-create actions live in the header. No filter/sort/
 * pagination state -- `HomePage` is a thin orchestrator, this screen is
 * presentational.
 *
 * **Needs Attention**: every Blocked/In Progress task in `mergedTasks`
 * (`lib/needs-attention.ts`'s `attentionTasks`) -- unlike `/tasks` (weekly-
 * only, see CLAUDE.md "Task and Calendar views (Phase 3)"), Home has always
 * covered weeklies AND dailies together, and WP4 additionally folds in the
 * viewer's own assigned-elsewhere tasks (ones living in a report they
 * cannot open at all). Capped at `ATTENTION_LIMIT` with a "+N more" link
 * into `/tasks` that always reports the TRUE remaining count.
 *
 * WP4: rows are no longer whole-row-clickable (`Table`'s `onRowClick`) --
 * an assigned-elsewhere entry has no report to navigate to at all
 * (`source.canOpen === false`), so this now renders an explicit `actions`
 * column instead (mirroring `RECENT_COLUMNS`/`TaskList.tsx`'s own pattern):
 * a "View" link when `canOpen`, or a muted "Assigned to you" label
 * explaining why the row is here despite having nowhere to click when it
 * isn't. The `attentionRemaining` "+N more" link points at plain `/tasks`
 * (not `/tasks?view=schedule`) -- the section header's own link is the
 * `?view=schedule` one. `/tasks` itself stays weekly-only for OWN reports
 * (see CLAUDE.md), so a daily-only (non-assigned) task past the cap won't
 * literally appear there -- same pre-existing, documented gap as `/tasks`
 * and `/calendar` not surfacing owned dailies (CLAUDE.md's own "Dailies
 * aren't surfaced here yet" note); `/tasks` is still the closest existing
 * "see everything" destination, and this is not a new problem this feature
 * introduces.
 */
export function HomeScreen({ weeklies, dailies, mergedTasks }: HomeScreenProps) {
  const router = useRouter();

  const grouped = groupMergedTasksByStatus(mergedTasks);
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
  const attention = useMemo(() => attentionTasks(mergedTasks, today), [mergedTasks, today]);
  const attentionShown = attention.slice(0, ATTENTION_LIMIT);
  const attentionRemaining = attention.length - attentionShown.length;

  const attentionRows = attentionShown.map(({ entry, overdue }) => ({
    client: entry.task.client,
    task: entry.task.task,
    status: <Badge tone={taskTone(entry.task.status)}>{entry.task.status}</Badge>,
    deadline: (
      <span className={styles.deadlineCell}>
        {fmtDateShort(entry.task.deadline)}
        {overdue ? <span className={styles.overdueMarker}>Overdue</span> : null}
      </span>
    ),
    actions: entry.source.canOpen ? (
      <Link href={entry.source.kind === 'weekly' ? `/reports/${entry.source.reportId}` : `/daily/${entry.source.reportId}`} className={styles.rowAction}>
        View
      </Link>
    ) : (
      <span className={styles.noAccessLabel}>Assigned to you</span>
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
              <Table columns={ATTENTION_COLUMNS} rows={attentionRows} stacked />
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
