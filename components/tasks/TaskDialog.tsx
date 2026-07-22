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
import { assigneeSelectOptions, assigneeSelectValue, resolveAssigneeId } from '@/lib/team';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { AssignedTaskPatch, Report, Task, TaskStatus, TeamMember } from '@/lib/types';
import styles from './TaskDialog.module.css';

export type TaskDialogMode = 'edit' | 'add';

export interface TaskDialogProps {
  mode: TaskDialogMode;
  open: boolean;
  onClose: () => void;
  /** Edit mode's target -- `null` in Add mode (and while closed, before a row/card selection lands; see `ConfirmDeleteReportDialog`'s identical nullable-while-closed convention). */
  entry: MergedTaskEntry | null;
  /**
   * Add mode's Report picker options, AND Edit mode's source of the full
   * parent report when `entry.canEditFull` is true. WP4 (the access flip's
   * task-surface follow-up): the caller (`TaskViewScreen`) already filters
   * this to reports the viewer may actually create/edit a task in
   * (`canEditReport(...) === true`) -- pre-WP3 this was simply "every
   * weekly report `useReports()` returned," which under org-wide reads
   * could include a report a pm/admin doesn't own; Add mode's picker would
   * happily offer it, only for `tasks_insert` RLS to reject the write.
   * Filtering up front means the picker never offers a target the write is
   * guaranteed to fail against.
   */
  reports: Report[];
  /**
   * Persists `tasks` into `reportId`'s `tasks[]` -- the FULL-report write
   * path, used whenever the target entry's `canEditFull` is true (Add mode
   * always uses this path -- adding a task only ever targets a report the
   * viewer already owns). Rejects on failure (a curated message in
   * Supabase mode, a plain `Error` in demo mode); this dialog surfaces
   * `err.message` inline and stays open on rejection, closing only on
   * success -- same shape as `ProjectDetailScreen.handleRename`/
   * `handleDelete`.
   */
  onSubmit: (reportId: string, tasks: Task[]) => Promise<void>;
  /**
   * WP4: the NARROW assignee-only write path -- used in Edit mode when
   * `entry.canEditAssigned` is true (and `canEditFull` is false). Routes to
   * the repository's `updateTask` (`AssignedTaskPatch`: status/deadline/
   * completedAt ONLY -- never client/task/assigneeId, mirroring that SQL
   * function's own narrow column list). Never called in Add mode -- an
   * assignee-only capability has no report of its own to add a NEW task
   * into.
   */
  onSubmitAssigned: (taskId: string, patch: AssignedTaskPatch) => Promise<void>;
  /** WP2: the team directory, for the Assignee `<Select>` below -- `useTeamMembers()` at the call site (TaskViewScreen). Always defined, may be `[]` while still loading (the Select then shows only "Unassigned", same graceful-degrade posture `clientSuggestions` gets elsewhere). */
  teamMembers: TeamMember[];
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
 * link up to the parent report (`/reports/[id]`, via `reportPeriodLabel` --
 * WP4: only rendered when `entry.source.canOpen`, since an
 * assigned-elsewhere task's parent report genuinely has nowhere for that
 * link to go) so the old click-through-to-report destination isn't lost,
 * and a quiet `danger` Delete that swaps this dialog's body to a
 * confirmation step (`confirmingDelete`) instead of deleting on a single
 * click -- an internal state toggle, not a nested Radix Dialog, since a
 * second step inside the same panel reads cleaner here than stacking two
 * dismissable layers for what's ultimately one decision. A fifth field,
 * "Completed On" (`completedAt`), appears ONLY while Status reads
 * 'Complete' -- prefilled from `entry.task.completedAt`, auto-stamped/
 * cleared live as Status changes (see the Select's own `onChange`), and
 * independently editable afterward for a PM's correction. WP2 adds a sixth
 * field, "Assignee" (a `<Select>` over the team directory + an
 * "Unassigned" option -- see `lib/team.ts`'s `assigneeSelectOptions`/
 * `assigneeSelectValue`/`resolveAssigneeId`), unconditional (unlike
 * "Completed On", it's always shown, not gated on Status).
 *
 * **Add mode**: the same fields (blank, `status` defaulting to
 * `'In Progress'` -- matching `useWizard.ts`'s own `addTask()` default)
 * PLUS a Report picker, defaulting to `mostRecentReportId(reports)`. WP2:
 * Add mode is a genuine creation site, so `handleSave` stamps a fresh
 * `createdAt` here (never on the Edit-mode branch -- see that function's
 * own comment).
 *
 * **WP4 (the access flip's task-surface follow-up): writes route by
 * capability, and the fields that can change follow it.** Three tiers,
 * derived from `entry.canEditFull`/`entry.canEditAssigned` (`lib/
 * task-merge.ts`):
 * - `canEditFull` (the viewer owns the parent report, or this is Add mode,
 *   which only ever targets an owned report): every field is editable,
 *   Delete is offered, Save goes through `onSubmit` -- unchanged from
 *   before this package.
 * - `canEditAssigned` only (the viewer is this task's assignee, but not the
 *   report's owner): Client/Task/Assignee lock to `readOnly`/`disabled`
 *   (the assignee RPC can never touch them -- see `AssignedTaskPatch`'s own
 *   doc comment), Status/Deadline/Completed On stay editable, there is no
 *   Delete, and Save goes through the new `onSubmitAssigned` instead.
 * - Neither (a pm/admin browsing a report they don't own and aren't
 *   assigned a task on, under org-wide reads): EVERY field locks, there is
 *   no Delete and no Save at all -- this dialog becomes a pure viewer, with
 *   an explanatory note instead of a mystery-disabled form.
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
export function TaskDialog({ mode, open, onClose, entry, reports, onSubmit, onSubmitAssigned, teamMembers }: TaskDialogProps) {
  const [client, setClient] = useState('');
  const [taskText, setTaskText] = useState('');
  const [status, setStatus] = useState<TaskStatus>('In Progress');
  const [deadline, setDeadline] = useState('');
  /** WP2: mirrors `deadline`'s plain-string convention -- the sentinel-normalized `assigneeId`, `''`/undefined meaning "unassigned" once resolved via `resolveAssigneeId` on Save. Prefilled from `entry.task.assigneeId` on open (Edit mode); blank (Unassigned) on Add. */
  const [assigneeId, setAssigneeId] = useState('');
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

  const entryKey = entry ? `${entry.source.reportId}::${entry.task.id}` : null;

  // WP4: the three-tier capability computation this whole dialog's field-
  // locking/Save-routing/Delete-visibility all key off. Add mode is always
  // "full" (it only ever targets a report from the caller's own
  // already-filtered `reports` list, see this component's own doc comment).
  const canEditFull = mode === 'add' || (entry?.canEditFull ?? false);
  const canEditAssigned = mode === 'edit' && !canEditFull && (entry?.canEditAssigned ?? false);
  const readOnly = mode === 'edit' && !canEditFull && !canEditAssigned;
  // Client/Task/Assignee: only the full-report path may ever change these
  // (the assignee RPC's own column list excludes them -- AssignedTaskPatch).
  const fieldsLocked = !canEditFull;
  // Status/Deadline/Completed On: locked only with ZERO write capability --
  // both the full-report path and the narrow assignee path may change these.
  const statusFieldsLocked = readOnly;

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && entry) {
      setClient(entry.task.client);
      setTaskText(entry.task.task);
      setStatus(entry.task.status);
      setDeadline(entry.task.deadline);
      setCompletedAt(entry.task.completedAt ?? '');
      setAssigneeId(entry.task.assigneeId ?? '');
    } else {
      setClient('');
      setTaskText('');
      setStatus('In Progress');
      setDeadline('');
      setCompletedAt('');
      setAssigneeId('');
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

  const targetReport =
    mode === 'edit'
      ? canEditFull
        ? (reports.find((r) => r.id === entry?.source.reportId) ?? null)
        : null
      : (reports.find((r) => r.id === reportId) ?? null);
  const canSubmit = !submitting && (canEditAssigned || targetReport !== null);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    // WP4: the narrow assignee-only path -- status/deadline/completedAt
    // ONLY, routed straight to the repository's `updateTask`, never
    // touching `client`/`task`/`assigneeId`.
    if (mode === 'edit' && canEditAssigned && entry) {
      const patch: AssignedTaskPatch = { status, deadline, completedAt };
      try {
        await onSubmitAssigned(entry.task.id, patch);
        onClose();
      } catch (err) {
        setError(errorMessage(err, 'Failed to save the task.'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!targetReport) {
      setSubmitting(false);
      return;
    }
    const fields = { client, task: taskText, status, deadline, completedAt, assigneeId: assigneeId || undefined };
    // WP2: `createdAt` is stamped ONLY on the Add-mode branch below (a
    // genuine creation site) -- never included in `fields`/passed to
    // `withTaskEdited`, so editing an existing task can never touch its
    // recorded creation date (see lib/schema/report.ts's `TaskSchema.
    // createdAt` doc comment: stamped once, at creation, never after).
    const nextTasks =
      mode === 'edit' && entry
        ? withTaskEdited(targetReport, entry.task.id, fields, nowDate())
        : withTaskAdded(targetReport, { id: uid('t'), ...fields, createdAt: nowDate() });
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
    if (!entry || !targetReport || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(targetReport.id, withTaskRemoved(targetReport, entry.task.id));
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete the task.'));
      setSubmitting(false);
    }
  }

  const reportOptions = reports.map((r) => ({ value: r.id, label: reportPeriodLabel(r) }));
  const title = mode === 'edit' ? 'Edit Task' : 'Add Task';

  // WP4: explains a locked/partly-locked dialog instead of leaving disabled
  // fields as an unexplained mystery -- same "disable, don't hide, and say
  // why" posture as ProjectDetailScreen's `.adminHint`/TaskViewScreen's
  // `.addTaskHint`.
  const capabilityNote = readOnly
    ? "You can view this task, but only its owner or assignee can edit it."
    : canEditAssigned
      ? "You're this task's assignee -- you can update its status, deadline, and completed date. Only the report's owner can change its client, task text, or assignee."
      : null;

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
          {mode === 'edit' && entry && entry.source.canOpen ? (
            <Link href={entry.source.kind === 'weekly' ? `/reports/${entry.source.reportId}` : `/daily/${entry.source.reportId}`} className={styles.reportLink}>
              View {entry.source.periodLabel} Report &rarr;
            </Link>
          ) : null}

          {capabilityNote ? <p className={styles.dialogNote}>{capabilityNote}</p> : null}

          <div className={styles.fieldsGrid}>
            <Input
              label="Client"
              value={client}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setClient(e.target.value)}
              readOnly={fieldsLocked}
            />
            <Input
              label="Task"
              value={taskText}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTaskText(e.target.value)}
              readOnly={fieldsLocked}
            />
            <Select
              label="Status"
              options={[...TASK_STATUS_OPTIONS]}
              value={status}
              disabled={statusFieldsLocked}
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
              readOnly={statusFieldsLocked}
            />
            {status === 'Complete' ? (
              <div className={styles.fieldFull}>
                <Input
                  type="date"
                  label="Completed On"
                  value={completedAt}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCompletedAt(e.target.value)}
                  readOnly={statusFieldsLocked}
                />
              </div>
            ) : null}
            {/* WP2: full-width, unconditional (unlike "Completed On" above, which only shows for a Complete-status row) -- an assignee is meaningful regardless of status. WP4: locked with Client/Task -- the assignee RPC can never reassign a task. */}
            <div className={styles.fieldFull}>
              <Select
                label="Assignee"
                options={assigneeSelectOptions(teamMembers)}
                value={assigneeSelectValue(assigneeId)}
                disabled={fieldsLocked}
                onChange={(value) => setAssigneeId(resolveAssigneeId(value) ?? '')}
              />
            </div>
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
            {mode === 'edit' && canEditFull ? (
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
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {readOnly ? null : mode === 'add' ? (
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
