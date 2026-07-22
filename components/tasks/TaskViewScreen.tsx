'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { IconPlus } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Tabs';
import { withTaskStatus } from '@/lib/report-utils';
import { isScheduleBucket } from '@/lib/task-schedule';
import type { ScheduleBucket } from '@/lib/task-schedule';
import type { Report, TaskStatus } from '@/lib/types';
import { allTasks, groupTasksByStatus } from '@/lib/view-utils';
import type { TaskEntry } from '@/lib/view-utils';
import { KanbanBoard } from './KanbanBoard';
import { TaskDialog } from './TaskDialog';
import type { TaskDialogMode } from './TaskDialog';
import { TaskList } from './TaskList';
import { TaskScheduleView } from './TaskScheduleView';
import styles from './TaskViewScreen.module.css';

export interface TaskViewScreenProps {
  reports: Report[];
  /**
   * Task CRUD: now returns `Promise<void>` (resolves on success, rejects on
   * failure) instead of `void` -- the dialog needs to know whether its
   * write actually landed so it can close on success / stay open with an
   * error on rejection (see TaskDialog's own doc comment). The Kanban drag
   * path's existing "swallow the rejection, just show `mutationError`"
   * behavior (previously `.catch(() => {})` at the `app/(shell)/tasks/
   * page.tsx` call site) moves down into `handleTaskStatusChange` below,
   * byte-for-byte -- see that function's own comment and the route
   * wrapper's updated doc comment for why the catch had to move rather than
   * just being duplicated.
   */
  onUpdateReportFields: (id: string, patch: Partial<Report>) => Promise<void>;
  /** Phase 7b (BLOCKER 3): `useReports().mutationError` -- surfaced here so a failed Kanban drag (e.g. PATCHing a report this user doesn't own under Supabase RLS) reads as a visible error, not "the app broke". The card itself already reverts (the hook's own rollback), this is just the explanation. */
  mutationError?: string | null;
}

const TASK_VIEW_MODES = ['list', 'kanban', 'schedule'] as const;
type TaskViewMode = (typeof TASK_VIEW_MODES)[number];

function isTaskViewMode(value: string | null): value is TaskViewMode {
  return value !== null && (TASK_VIEW_MODES as readonly string[]).includes(value);
}

/** Task CRUD: which flavor of `TaskDialog` is open, and (for Edit) which task it targets. `null` = closed. */
type TaskDialogState = { mode: TaskDialogMode; entry: TaskEntry | null };

/**
 * `/tasks` -- every task across every report, in three modes (List, Kanban,
 * Schedule -- the last one added for the "delivered on time, and why not"
 * view, see `lib/task-schedule.ts`). Owns its own (small) `mode` toggle
 * state directly, the same way `ReportScreen` owns its Share-dialog state:
 * this route is simple enough (no filters, one `useReports()` call already
 * made by the thin page wrapper) that a separate route-level orchestrator
 * would be pure ceremony. Task CRUD adds one more small piece of directly-
 * owned state (`dialogState`, below) for the same reason.
 *
 * `?view=<mode>` is deep-linked, synced with `window.history.replaceState`
 * -- the exact `?tab=` idiom `SettingsScreen.tsx` established (shallow, no
 * `router.replace`, so switching tabs never triggers a Next navigation/
 * re-render of the route tree). `?filter=<bucket>` is read ONCE, on mount,
 * and handed to `TaskScheduleView` as its initial bucket selection -- it is
 * how a dashboard/report stat card link (e.g.
 * `/tasks?view=schedule&filter=overdue-blocked`) lands pre-filtered. Both
 * params are read via `useSearchParams()`, which is why
 * `app/(shell)/tasks/page.tsx` wraps this in `<Suspense>` (mirroring
 * `app/(shell)/settings/page.tsx`).
 */
export function TaskViewScreen({ reports, onUpdateReportFields, mutationError }: TaskViewScreenProps) {
  const searchParams = useSearchParams();
  const paramView = searchParams.get('view');
  const paramFilter = searchParams.get('filter');

  const [mode, setMode] = useState<TaskViewMode>(isTaskViewMode(paramView) ? paramView : 'list');
  // Deliberately NOT kept in a `useState` that re-derives on further
  // `searchParams` changes -- `TaskScheduleView` reads this exactly once
  // (see that component's own doc comment), so a plain validated constant
  // here is enough; there is no need to re-run `isScheduleBucket` on every
  // render.
  const initialScheduleFilter: ScheduleBucket | null = isScheduleBucket(paramFilter) ? paramFilter : null;
  const [dialogState, setDialogState] = useState<TaskDialogState | null>(null);

  const entries = useMemo(() => allTasks(reports), [reports]);
  const grouped = useMemo(() => groupTasksByStatus(entries), [entries]);

  const openEditDialog = (entry: TaskEntry) => setDialogState({ mode: 'edit', entry });
  const openAddDialog = () => setDialogState({ mode: 'add', entry: null });
  const closeDialog = () => setDialogState(null);

  /**
   * Task CRUD (Kanban drag, unchanged behavior): mirrors the pre-existing
   * `.catch(() => {})` that used to live at `app/(shell)/tasks/page.tsx`'s
   * call site -- moved here verbatim (not duplicated) now that
   * `onUpdateReportFields` itself returns a real `Promise<void>` the DIALOG
   * needs to `await`. A denied drag (e.g. a non-owner dragging a card under
   * Supabase RLS) still just reverts optimistically and surfaces
   * `mutationError` above -- see that prop's doc comment; this function's
   * behavior is byte-for-byte what it was before this change.
   */
  const handleTaskStatusChange = (reportId: string, taskId: string, status: TaskStatus) => {
    const report = reports.find((r) => r.id === reportId);
    if (!report) return;
    onUpdateReportFields(reportId, { tasks: withTaskStatus(report, taskId, status) }).catch(() => {});
  };

  /**
   * Task CRUD: the one write path every `TaskDialog` action (Save in Edit
   * mode, Add in Add mode, Delete) funnels through. `TaskDialog` itself
   * computes the final `tasks[]` (via `withTaskEdited`/`withTaskAdded`/
   * `withTaskRemoved`, `lib/report-utils.ts`) and hands it here -- this is
   * just the thin adapter to `onUpdateReportFields`, unlike
   * `handleTaskStatusChange` above, this one does NOT swallow a rejection:
   * `TaskDialog` awaits it directly so it can surface the failure inline
   * and stay open (see that component's own doc comment).
   */
  const handleDialogSubmit = (reportId: string, tasks: Report['tasks']) => onUpdateReportFields(reportId, { tasks });

  /**
   * `?view=` sync -- the `SettingsScreen.tsx` `?tab=` idiom verbatim: shallow
   * `window.history.replaceState`, never `router.replace` (no navigation/
   * re-render of the route tree just to reflect which tab is showing).
   * `?filter=` is deliberately dropped once the user is no longer on the
   * Schedule tab -- it only ever means anything there, and leaving a stale
   * `filter=overdue-blocked` in the URL while looking at List/Kanban would
   * be a silent trap for a bookmarked/shared link.
   */
  const handleModeChange = (value: string) => {
    const next = isTaskViewMode(value) ? value : 'list';
    setMode(next);
    const params = new URLSearchParams(window.location.search);
    params.set('view', next);
    if (next !== 'schedule') params.delete('filter');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>Tasks</span>
        <Button
          variant="accent"
          size="sm"
          icon={<IconPlus />}
          onClick={openAddDialog}
          disabled={reports.length === 0}
          title={reports.length === 0 ? 'Create a weekly report first -- there is nowhere to add a task to yet.' : undefined}
        >
          Add Task
        </Button>
      </div>

      <div className={styles.content}>
        {/* Mode-aware: the original copy ("grouped by status") describes what
            List and Kanban do, and became inaccurate the moment Schedule
            landed -- Schedule groups by DELIVERY TIMING (was it late, and
            why), not by task status. A subtitle that misdescribes the view
            under it is worse than no subtitle. */}
        <p className={styles.subtitle}>
          {mode === 'schedule'
            ? 'Every task across every report, grouped by whether it landed on time -- and what held it up.'
            : 'Every task across every report, grouped by status.'}
        </p>

        {reports.length === 0 ? (
          <div className={styles.addTaskHint}>Create a weekly report first -- there is nowhere to add a task to yet.</div>
        ) : null}

        {mutationError ? (
          // NIT fix (post-review round 2): `role="alert"` (implicit
          // `aria-live="assertive"`), not `role="status"` -- a dedicated
          // failure block needing action shouldn't queue behind other
          // polite announcements. `ReportScreen`'s save/failure TOGGLE
          // stays `status` on purpose (see that component) -- this is a
          // different pattern (a block that only appears on failure).
          <div className={styles.mutationError} role="alert">
            {mutationError}
          </div>
        ) : null}

        <Tabs
          aria-label="Task view mode"
          value={mode}
          onChange={handleModeChange}
          items={[
            {
              value: 'list',
              label: 'List',
              content: (
                <div className={styles.panel}>
                  <TaskList grouped={grouped} onTaskClick={openEditDialog} />
                </div>
              ),
            },
            {
              value: 'kanban',
              label: 'Kanban',
              content: (
                <div className={styles.panel}>
                  <KanbanBoard grouped={grouped} onTaskOpen={openEditDialog} onTaskStatusChange={handleTaskStatusChange} />
                </div>
              ),
            },
            {
              value: 'schedule',
              label: 'Schedule',
              content: (
                <div className={styles.panel}>
                  <TaskScheduleView reports={reports} initialFilter={initialScheduleFilter} />
                </div>
              ),
            },
          ]}
        />
      </div>

      <TaskDialog
        mode={dialogState?.mode ?? 'add'}
        open={dialogState !== null}
        entry={dialogState?.entry ?? null}
        reports={reports}
        onClose={closeDialog}
        onSubmit={handleDialogSubmit}
      />
    </div>
  );
}
