'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { TaskList } from '@/components/tasks/TaskList';
import { addDaysISO, addWeeksISO, endOfWeekISO, startOfWeekISO } from '@/lib/calendar';
import { fmtDateShort, fmtWeekLabel, nowDate } from '@/lib/format';
import { useAssignedTasks } from '@/lib/hooks/useAssignedTasks';
import { useSession } from '@/lib/hooks/useSession';
import { assignedTaskOverlapsRange, filterReportsByScope, reportsInRange } from '@/lib/my-week';
import type { MyWeekScope } from '@/lib/my-week';
import { hasRoleAtLeast } from '@/lib/roles';
import { reportPeriodEnd, reportPeriodLabel, statusTone } from '@/lib/report-utils';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { groupMergedTasksByStatus, mergeTaskSources } from '@/lib/task-merge';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { DailyReport, Report } from '@/lib/types';
import styles from './MyWeekScreen.module.css';

export interface MyWeekScreenProps {
  weeklies: Report[];
  dailies: DailyReport[];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const REPORT_COLUMNS: TableColumn[] = [
  { key: 'kind', label: 'Type' },
  { key: 'period', label: 'Period' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * `/my-week` -- WP6, the final package of the RBAC rollout. A personal work
 * digest over the SAME merged task set every other task-centric surface
 * shares (`mergeTaskSources`, lib/task-merge.ts, see WP4/WP5's own CLAUDE.md
 * sections) plus the reports that produced it, filterable to a single week
 * or (via drill-down) a single day, and exportable as a branded PDF deck
 * from either. No-orchestrator pattern (like `TaskViewScreen`/
 * `CalendarScreen`): this route is simple enough (one week anchor, one
 * scope toggle, one optional `?date=`) that a separate route-level
 * orchestrator would be pure ceremony.
 *
 * **Week vs. day is ONE view, not two** -- `date` (mirrored to `?date=` via
 * `history.replaceState`, the exact `?tab=`/`?view=` idiom `SettingsScreen`/
 * `TaskViewScreen` already established) narrows `[rangeStart, rangeEnd]` to
 * a single day; `null` widens it back to the whole Monday-anchored week.
 * Every stat/table/list below reads off that ONE range, so there is no
 * separate "day mode" render branch to keep in sync with the week one.
 * `replaceState` (not `pushState`) is deliberate, matching every other
 * shallow-URL-sync call site in this app -- day drill-down is a client-side
 * filter change, not a "new place" worth its own browser-history entry; "Back
 * to Week" is an explicit control instead (see the day-picker row below).
 *
 * **Scope** (`MyWeekScope`, lib/my-week.ts): the Mine/Everyone toggle renders
 * only for `hasRoleAtLeast(user, 'pm')` -- `false` unconditionally in demo
 * mode (no session, no roles) and for a plain member, so the toggle is
 * simply absent there rather than rendered-but-disabled; for either of those
 * two audiences `scope` stays its default (`'mine'`) forever, which is a
 * harmless no-op given what "everyone" already degrades to for them (see
 * `filterReportsByScope`'s own doc comment).
 *
 * **Export** always opens `/my-week/present` in a new tab with the exact
 * `weekStart`/`scope`/(optional)`date` querystring the present route needs to
 * REBUILD the identical synthetic report from its own hooks (see that
 * route's own doc comment) -- nothing is ever handed over through
 * localStorage or a global.
 */
export function MyWeekScreen({ weeklies, dailies }: MyWeekScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [today] = useState(() => nowDate());
  const [date, setDateState] = useState<string | null>(() => searchParams.get('date'));
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(date ?? today));
  const [scope, setScope] = useState<MyWeekScope>('mine');

  const { tasks: assignedTasks } = useAssignedTasks();
  const { user, loading: sessionLoading } = useSession();
  const canToggleScope = hasRoleAtLeast(user, 'pm');

  // A fresh object every render on purpose -- `canEditReport`/
  // `mergeTaskSources` only ever read it synchronously during THIS render
  // (mirrors `TaskViewScreen.tsx`'s identical `access` construction); the
  // `useMemo`s below depend on the underlying primitives (`user`/
  // `sessionLoading`), not on `access` itself, so they still memoize
  // correctly across renders where neither primitive changed.
  const access = { user, loading: sessionLoading, supabaseConfigured: isSupabaseConfigured() };

  const weekEnd = endOfWeekISO(weekStart);
  const rangeStart = date ?? weekStart;
  const rangeEnd = date ?? weekEnd;

  const allReports = useMemo(() => [...weeklies, ...dailies], [weeklies, dailies]);
  const scopedReports = useMemo(
    () => filterReportsByScope(allReports, scope, access),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allReports, scope, user, sessionLoading]
  );
  const reportsForRange = useMemo(
    () => reportsInRange(scopedReports, rangeStart, rangeEnd),
    [scopedReports, rangeStart, rangeEnd]
  );

  const assignedForRange = useMemo(
    () => (assignedTasks ?? []).filter((t) => assignedTaskOverlapsRange(t, rangeStart, rangeEnd)),
    [assignedTasks, rangeStart, rangeEnd]
  );

  const mergedTasks: MergedTaskEntry[] = useMemo(
    () => mergeTaskSources(reportsForRange, assignedForRange, access),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportsForRange, assignedForRange, user, sessionLoading]
  );
  const grouped = useMemo(() => groupMergedTasksByStatus(mergedTasks), [mergedTasks]);
  const openTasks = grouped.Blocked.length + grouped['In Progress'].length;
  const blocked = grouped.Blocked.length;

  const setDate = (next: string | null) => {
    setDateState(next);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next) params.set('date', next);
    else params.delete('date');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };

  const handlePrevWeek = () => {
    setWeekStart((v) => addWeeksISO(v, -1));
    setDate(null);
  };
  const handleNextWeek = () => {
    setWeekStart((v) => addWeeksISO(v, 1));
    setDate(null);
  };
  const handleToday = () => {
    setWeekStart(startOfWeekISO(today));
    setDate(null);
  };

  const handleTaskClick = (entry: MergedTaskEntry) => {
    if (!entry.source.canOpen) return;
    router.push(entry.source.kind === 'weekly' ? `/reports/${entry.source.reportId}` : `/daily/${entry.source.reportId}`);
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set('weekStart', weekStart);
    params.set('scope', scope);
    if (date) params.set('date', date);
    params.set('print', '1');
    window.open(`/my-week/present?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  const title = date ? `My Day` : `My Week`;
  const rangeLabel = date ? fmtDateShort(date) : fmtWeekLabel(weekStart, weekEnd);

  const reportRows = [...reportsForRange]
    .sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)))
    .map((r) => ({
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
        title={title}
        actions={
          <Button variant="dark" size="md" onClick={handleExport}>
            Export {date ? 'Day' : 'Week'} (PDF)
          </Button>
        }
      />

      <div className={styles.content}>
        <div className={styles.toolbar}>
          <div className={styles.rangeLabel}>{rangeLabel}</div>
          <div className={styles.nav}>
            <Button variant="outline" size="sm" onClick={handlePrevWeek}>
              &larr; Prev Week
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={handleNextWeek}>
              Next Week &rarr;
            </Button>
          </div>
          {canToggleScope ? (
            <div className={styles.scopeRow} role="group" aria-label="Scope">
              <Button variant={scope === 'mine' ? 'dark' : 'outline'} size="sm" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
                Mine
              </Button>
              <Button
                variant={scope === 'everyone' ? 'dark' : 'outline'}
                size="sm"
                aria-pressed={scope === 'everyone'}
                onClick={() => setScope('everyone')}
              >
                Everyone
              </Button>
            </div>
          ) : null}
        </div>

        <div className={styles.dayRow} role="group" aria-label="Day">
          <Button variant={!date ? 'dark' : 'outline'} size="sm" aria-pressed={!date} onClick={() => setDate(null)}>
            Whole Week
          </Button>
          {weekDays.map((d, i) => (
            <Button key={d} variant={date === d ? 'dark' : 'outline'} size="sm" aria-pressed={date === d} onClick={() => setDate(d)}>
              {DAY_LABELS[i]} {fmtDateShort(d).split(',')[0]}
            </Button>
          ))}
        </div>

        <div className={styles.statsGrid}>
          <StatCard label="Reports" value={String(reportsForRange.length)} />
          <StatCard label="Open Tasks" value={String(openTasks)} />
          <StatCard label="Blocked Tasks" value={String(blocked)} />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionKicker}>Reports</div>
          {reportRows.length === 0 ? (
            <div className={styles.emptyState}>No reports for {date ? 'this day' : 'this week'}.</div>
          ) : (
            <Table columns={REPORT_COLUMNS} rows={reportRows} stacked />
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionKicker}>Tasks</div>
          <TaskList grouped={grouped} onTaskClick={handleTaskClick} />
        </div>
      </div>
    </div>
  );
}
