'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { IconPlus } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Tabs';
import { withTaskStatus } from '@/lib/report-utils';
import type { Report, TaskStatus } from '@/lib/types';
import { allTasks, groupTasksByStatus } from '@/lib/view-utils';
import type { TaskEntry } from '@/lib/view-utils';
import { KanbanBoard } from './KanbanBoard';
import { TaskDialog } from './TaskDialog';
import type { TaskDialogMode } from './TaskDialog';
import { TaskList } from './TaskList';
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

type TaskViewMode = 'list' | 'kanban';

/** Task CRUD: which flavor of `TaskDialog` is open, and (for Edit) which task it targets. `null` = closed. */
type TaskDialogState = { mode: TaskDialogMode; entry: TaskEntry | null };

/**
 * `/tasks` -- every task across every report, in two modes. Owns its own
 * (small) `mode` toggle state directly, the same way `ReportScreen` owns
 * its Share-dialog state: this route is simple enough (no filters, one
 * `useReports()` call already made by the thin page wrapper) that a
 * separate route-level orchestrator would be pure ceremony. Task CRUD adds
 * one more small piece of directly-owned state (`dialogState`, below) for
 * the same reason.
 */
export function TaskViewScreen({ reports, onUpdateReportFields, mutationError }: TaskViewScreenProps) {
  const [mode, setMode] = useState<TaskViewMode>('list');
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
        <p className={styles.subtitle}>Every task across every report, grouped by status.</p>

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
          onChange={(value) => setMode(value as TaskViewMode)}
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
