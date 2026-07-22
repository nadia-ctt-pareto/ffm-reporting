'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { nowDate, uid } from '@/lib/format';
import { TASK_STATUS_OPTIONS } from '@/lib/constants';
import { reportPeriodLabel, taskCompletionStamp, withTaskAdded, withTaskEdited, withTaskRemoved } from '@/lib/report-utils';
import type { Report, Task, TaskStatus } from '@/lib/types';
import type { TaskEntry } from '@/lib/view-utils';
import styles from './TaskDialog.module.css';

export type TaskDialogMode = 'edit' | 'add';

export interface TaskDialogProps {
  mode: TaskDialogMode;
  open: boolean;
  onClose: () => void;
  /** Edit mode's target -- `null` in Add mode (and while closed, before a row/card selection lands; see `ConfirmDeleteReportDialog`'s identical nullable-while-closed convention). */
  entry: TaskEntry | null;
  /**
   * Add mode's Report picker options -- every weekly report (`/tasks` stays
   * weekly-only, see CLAUDE.md's "Scope stays weekly-only"), in whatever
   * order the caller passes. `TaskViewScreen` passes them unsorted; THIS
   * component sorts a local copy by `weekEnd` desc purely to pick the
   * DEFAULT selection (`mostRecentReportId` below) -- the `<Select>`'s own
   * option order follows `reports` as given. Ignored (may be `[]`) in Edit
   * mode, where the target report is always `entry.report`.
   */
  reports: Report[];
  /**
   * Persists `tasks` into `reportId`'s `tasks[]` -- always
   * `useReports().updateReportFields(reportId, { tasks })` at the real call
   * site (`TaskViewScreen`). Rejects on failure (a curated message in
   * Supabase mode, a plain `Error` in demo mode); this dialog surfaces
   * `err.message` inline and stays open on rejection, closing only on
   * success -- same shape as `ProjectDetailScreen.handleRename`/
   * `handleDelete`.
   */
  onSubmit: (reportId: string, tasks: Task[]) => Promise<void>;
}

/** The Add-mode Report picker's default selection: the most recent report by `weekEnd` desc (CLAUDE.md's DECIDED #1). `''` when `reports` is empty -- callers must disable the Add Task trigger entirely in that case (see TaskViewScreen), this is only a defensive fallback. */
function mostRecentReportId(reports: Report[]): string {
  if (reports.length === 0) return '';
  return [...reports].sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))[0].id;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * ONE dialog serving both `/tasks` task-CRUD flows (built on
 * `components/ui/Dialog.tsx`, mirroring `ProjectDetailScreen`'s inline
 * rename/delete dialogs' "compute the write, await it, close on success,
 * show `err.message` on rejection" shape -- just promoted into its own file
 * since TWO callers (List row click, Kanban card click) need the exact same
 * form).
 *
 * **Edit mode**: Client/Task/Status/Deadline pre-filled from `entry.task`, a
 * link up to the parent report (`/reports/[id]`, via `reportPeriodLabel`) so
 * the old click-through-to-report destination isn't lost, and a quiet
 * `danger` Delete that swaps this dialog's body to a confirmation step
 * (`confirmingDelete`) instead of deleting on a single click -- an internal
 * state toggle, not a nested Radix Dialog, since a second step inside the
 * same panel reads cleaner here than stacking two dismissable layers for
 * what's ultimately one decision. A fifth field, "Completed On"
 * (`completedAt`), appears ONLY while Status reads 'Complete' -- prefilled
 * from `entry.task.completedAt`, auto-stamped/cleared live as Status
 * changes (see the Select's own `onChange`), and independently editable
 * afterward for a PM's correction.
 *
 * **Add mode**: the same fields (blank, `status` defaulting to
 * `'In Progress'` -- matching `useWizard.ts`'s own `addTask()` default)
 * PLUS a Report picker, defaulting to `mostRecentReportId(reports)`.
 *
 * **Validation is deliberately absent beyond the Report picker.** The
 * wizard's own `validateStep` (`lib/report-utils.ts`) never requires a
 * non-blank Client/Task/Deadline on an individual task row -- only that
 * `draft.tasks.length > 0` before advancing past that step -- so a blank
 * Client/Task here is not a stricter rule than the wizard already enforces,
 * it's the SAME (permissive) one. Adding a client-side "Task text is
 * required" check here would be inventing a rule the wizard doesn't have.
 *
 * **Resets on every open, not on every render**: the effect below only
 * fires when `open` transitions true (or the identity of what's being
 * edited changes while already open) -- it does NOT depend on `reports`,
 * even though the Add-mode branch reads it to compute the default
 * selection. See that effect's own comment for why depending on `reports`
 * would be an actual bug (a live report update elsewhere -- e.g. a Kanban
 * drag on an unrelated card -- could otherwise wipe out whatever the user
 * had already typed into an open Add Task dialog).
 */
export function TaskDialog({ mode, open, onClose, entry, reports, onSubmit }: TaskDialogProps) {
  const [client, setClient] = useState('');
  const [taskText, setTaskText] = useState('');
  const [status, setStatus] = useState<TaskStatus>('In Progress');
  const [deadline, setDeadline] = useState('');
  /**
   * Task completion date: mirrors `deadline`'s plain-string convention
   * exactly ('' = unset). Prefilled from `entry.task.completedAt` on open
   * (Edit mode); stamped/cleared live as the Status select below changes,
   * via the SAME `taskCompletionStamp` rule every other status-change path
   * uses (see that function's doc comment) -- so a Save always carries an
   * explicit, already-correct value into `withTaskEdited`/`withTaskAdded`,
   * rather than relying on `withTaskEdited`'s own fallback stamping.
   */
  const [completedAt, setCompletedAt] = useState('');
  const [reportId, setReportId] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryKey = entry ? `${entry.report.id}::${entry.task.id}` : null;

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && entry) {
      setClient(entry.task.client);
      setTaskText(entry.task.task);
      setStatus(entry.task.status);
      setDeadline(entry.task.deadline);
      setCompletedAt(entry.task.completedAt ?? '');
    } else {
      setClient('');
      setTaskText('');
      setStatus('In Progress');
      setDeadline('');
      setCompletedAt('');
      setReportId(mostRecentReportId(reports));
    }
    setConfirmingDelete(false);
    setSubmitting(false);
    setError(null);
    // Deliberately NOT depending on `reports` -- see this component's own
    // doc comment ("Resets on every open, not on every render"). `mode` and
    // `entryKey` are what identify a genuinely NEW dialog invocation;
    // `reports` changing while the SAME invocation stays open must not
    // clobber in-progress typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, entryKey]);

  const targetReport = mode === 'edit' ? (entry?.report ?? null) : (reports.find((r) => r.id === reportId) ?? null);
  const canSubmit = targetReport !== null && !submitting;

  async function handleSave() {
    if (!targetReport || submitting) return;
    setSubmitting(true);
    setError(null);
    const fields = { client, task: taskText, status, deadline, completedAt };
    const nextTasks =
      mode === 'edit' && entry
        ? withTaskEdited(targetReport, entry.task.id, fields, nowDate())
        : withTaskAdded(targetReport, { id: uid('t'), ...fields });
    try {
      await onSubmit(targetReport.id, nextTasks);
      onClose();
    } catch (err) {
      setError(errorMessage(err, mode === 'edit' ? 'Failed to save the task.' : 'Failed to add the task.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!entry || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(entry.report.id, withTaskRemoved(entry.report, entry.task.id));
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete the task.'));
      setSubmitting(false);
    }
  }

  const reportOptions = reports.map((r) => ({ value: r.id, label: reportPeriodLabel(r) }));
  const title = mode === 'edit' ? 'Edit Task' : 'Add Task';

  return (
    <Dialog open={open} onClose={onClose} title={title} width={480}>
      {mode === 'edit' && confirmingDelete ? (
        <div>
          <p className={styles.dialogNote}>Delete this task? This cannot be undone.</p>
          {error ? (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <span />
            <div className={styles.primaryActions}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="dangerSolid" size="sm" icon={<IconTrash />} onClick={handleDelete} disabled={submitting}>
                {submitting ? 'Deleting…' : 'Delete Task'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {mode === 'edit' && entry ? (
            <Link href={`/reports/${entry.report.id}`} className={styles.reportLink}>
              View {reportPeriodLabel(entry.report)} Report &rarr;
            </Link>
          ) : null}

          <div className={styles.fieldsGrid}>
            <Input label="Client" value={client} onChange={(e: ChangeEvent<HTMLInputElement>) => setClient(e.target.value)} />
            <Input label="Task" value={taskText} onChange={(e: ChangeEvent<HTMLInputElement>) => setTaskText(e.target.value)} />
            <Select
              label="Status"
              options={[...TASK_STATUS_OPTIONS]}
              value={status}
              onChange={(value) => {
                const nextStatus = value as TaskStatus;
                // Task completion date: stamp/clear live, via the same rule
                // every other status-change path uses -- see
                // `taskCompletionStamp`'s doc comment (lib/report-utils.ts).
                setCompletedAt((prevCompletedAt) => taskCompletionStamp({ status, completedAt: prevCompletedAt }, nextStatus, nowDate()));
                setStatus(nextStatus);
              }}
            />
            <Input
              type="date"
              label="Deadline"
              value={deadline}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDeadline(e.target.value)}
            />
            {status === 'Complete' ? (
              <div className={styles.fieldFull}>
                <Input
                  type="date"
                  label="Completed On"
                  value={completedAt}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCompletedAt(e.target.value)}
                />
              </div>
            ) : null}
            {mode === 'add' ? (
              <div className={styles.fieldFull}>
                <Select label="Report" options={reportOptions} value={reportId} onChange={setReportId} />
              </div>
            ) : null}
          </div>

          {error ? (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.dialogActions}>
            {mode === 'edit' ? (
              <Button
                variant="danger"
                size="sm"
                icon={<IconTrash />}
                onClick={() => {
                  setError(null);
                  setConfirmingDelete(true);
                }}
                disabled={submitting}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.primaryActions}>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              {mode === 'add' ? (
                <Button variant="accent" size="sm" icon={<IconPlus />} onClick={handleSave} disabled={!canSubmit}>
                  {submitting ? 'Adding…' : 'Add Task'}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSubmit}>
                  {submitting ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
