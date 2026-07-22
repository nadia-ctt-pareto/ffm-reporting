// WP4 (the access flip's task-surface follow-up): the ONE shared merge
// helper combining every task from whatever FULLY-loaded reports a caller
// already has (own reports, or -- for a pm/admin -- every org-wide-visible
// report too, per `reports_select`) with the caller's own
// assigned-elsewhere tasks (`useAssignedTasks()`, WP3's
// `list_assigned_tasks()`), deduped by task id. A task assigned to the
// viewer INSIDE a report they can already read arrives from BOTH sources --
// see `mergeTaskSources`'s own doc comment for exactly how the dedupe/
// capability merge works.
//
// Every task-centric surface goes through THIS function -- `/tasks`'s List
// and Kanban (Schedule stays weekly-own-only, unchanged, see
// lib/task-schedule.ts), Home's Needs Attention, and the Calendar's task
// lens (WP5, lib/task-calendar.ts) -- merging twice in two places is the
// one mistake this package's own plan called out by name.
//
// Deliberately NOT built on top of `lib/view-utils.ts`'s `allTasks`/
// `TaskEntry`: that pair is intentionally narrow to weekly `Report[]` (its
// own header comment predates daily-report support at `/tasks`), and its
// internal sort (`compareEntries`) reads `report.weekEnd` directly, which
// doesn't exist on a `DailyReport`. This module needs to accept mixed
// `AnyReport[]` (Home and the Calendar's task lens hand it weeklies AND
// dailies together) -- widening `allTasks` to match would have broken its
// own `compareEntries`, so this iterates reports directly instead. Pure, no
// React, no storage -- same style as `lib/view-utils.ts`/`lib/report-utils.ts`.
//
// `access` (`ReportAccessContext`) is the exact shape `canEditReport`
// already takes everywhere else in the app (DashboardPage, ReportScreen,
// WizardPage) -- reusing it here (rather than re-deriving ownership) is
// what keeps this merge from ever disagreeing with the report screen/
// wizard about who can edit what.

import { canEditReport } from './report-access';
import type { ReportAccessContext } from './report-access';
import { reportPeriodEnd, reportPeriodLabel } from './report-utils';
import type { AnyReport, AssignedTask, ReportKind, Task, TaskStatus } from './types';
import { fmtDateShort, fmtWeekLabel } from './format';
import { TASK_STATUS_ORDER } from './view-utils';

/**
 * Where a merged task's parent report lives, and what the viewer may do
 * about it -- deliberately NOT a (fake) `Report`/`AnyReport`. A task
 * assigned to the viewer on a report they cannot otherwise read genuinely
 * has no full report behind it on the client (see `AssignedTask`'s own doc
 * comment, lib/types.ts) -- synthesizing one would leak wrong data into any
 * selector that assumes a real report (narrative fields, sibling tasks/
 * risks that don't actually exist here).
 */
export interface TaskSourceRef {
  reportId: string;
  kind: ReportKind;
  /** Display text -- "Week of ..." for weekly, a short date for daily (mirrors `reportPeriodLabel`/`reportPeriodEnd` in lib/report-utils.ts). '' only if the assigned-task bridge's own weekEnd/date field is itself missing (never happens for a well-formed row -- kept a plain string rather than `string | undefined` so every consumer can render it unconditionally). */
  periodLabel: string;
  /** ISO sort key -- weekEnd for weekly, date for daily. */
  periodEnd: string;
  /**
   * True when the viewer can navigate to `/reports/[id]`/`/daily/[id]` for
   * this task's parent report -- i.e. it showed up in one of the report
   * lists the caller already fully loaded (own reports, or org-wide for a
   * pm/admin), not ONLY via the assignee bridge. Consumers must not render
   * a "View Report" link when this is false -- there is nowhere for it to
   * go.
   */
  canOpen: boolean;
}

export interface MergedTaskEntry {
  task: Task;
  source: TaskSourceRef;
  /**
   * True if the viewer owns the parent report -- the full read/write
   * surface (any field, delete, a Kanban drag to any column) via the
   * existing `updateReportFields`/task-array patch path. Mirrors
   * `canEditReport` exactly -- see that predicate's own doc comment for the
   * ownership rule this defers to.
   */
  canEditFull: boolean;
  /**
   * True if the viewer is this task's assignee AND does not already have
   * `canEditFull` -- the NARROW status/deadline/completedAt-only write
   * surface, via the repository's `updateTask` (`AssignedTaskPatch`).
   * Never true at the same time as `canEditFull`: an owner who happens to
   * also be their own task's assignee already has the wider path, and
   * routing through the narrower one too would just be a redundant, weaker
   * option for the identical write. An entry with BOTH flags false is
   * non-editable outright (a pm/admin browsing a report they neither own
   * nor are assigned a task on, under org-wide reads) -- Kanban must not
   * let it drag, and a dialog opened on it must show every field
   * read-only.
   */
  canEditAssigned: boolean;
}

function assignedPeriodLabel(t: AssignedTask): string {
  if (t.reportKind === 'weekly') return t.weekStart && t.weekEnd ? fmtWeekLabel(t.weekStart, t.weekEnd) : '';
  return t.date ? fmtDateShort(t.date) : '';
}

function assignedPeriodEnd(t: AssignedTask): string {
  return t.reportKind === 'weekly' ? (t.weekEnd ?? '') : (t.date ?? '');
}

/**
 * Strips `AssignedTask`'s bounded parent-report context back down to a
 * plain `Task` -- spelled out field-by-field (matching `TaskSchema`, lib/
 * schema/report.ts) rather than a destructure-and-discard, so a field added
 * to either shape in the future can't silently ride along or silently fall
 * off unnoticed.
 */
function assignedTaskToTask(t: AssignedTask): Task {
  return {
    id: t.id,
    client: t.client,
    projectId: t.projectId,
    task: t.task,
    status: t.status,
    deadline: t.deadline,
    completedAt: t.completedAt,
    assigneeId: t.assigneeId,
    createdAt: t.createdAt,
  };
}

/**
 * Merges every task in `reports` (whatever the caller has FULLY loaded --
 * weeklies only for `/tasks`, weeklies+dailies for Home/the Calendar's task
 * lens) with `assignedTasks` (WP3's `useAssignedTasks()`, always `[]` in
 * demo mode -- see that hook's own doc comment), deduped by task id.
 *
 * Dedup/capability rule, in order:
 * 1. Build the set of task ids the viewer is assigned to (`assignedIds`) --
 *    true REGARDLESS of whether that same task also shows up in `reports`:
 *    a pm/admin can legitimately be both a report's non-owner AND a task's
 *    assignee within it, since `reports_select`'s org-wide-read arm and
 *    `tasks_select`'s assignee arm are independent grants.
 * 2. Every task in `reports` becomes an entry with `canOpen: true` (it's
 *    provably readable -- it's IN a list the caller already loaded) and
 *    `canEditFull` from `canEditReport`. `canEditAssigned` is true only
 *    when `canEditFull` is false AND the task's id is in `assignedIds` --
 *    this is what correctly grants the narrow write path to a pm/admin
 *    who's browsing a report they don't own but happens to be personally
 *    assigned a task on.
 * 3. Any `assignedTasks` entry whose id was NOT already covered by step 2
 *    (i.e. genuinely invisible any other way) is added with
 *    `canOpen: false`, `canEditFull: false`, `canEditAssigned: true`.
 */
export function mergeTaskSources(reports: AnyReport[], assignedTasks: AssignedTask[], access: ReportAccessContext): MergedTaskEntry[] {
  const assignedIds = new Set(assignedTasks.map((t) => t.id));
  const seenIds = new Set<string>();
  const entries: MergedTaskEntry[] = [];

  for (const report of reports) {
    const canEditFull = canEditReport(report, access);
    for (const task of report.tasks) {
      seenIds.add(task.id);
      entries.push({
        task,
        source: {
          reportId: report.id,
          kind: report.kind,
          periodLabel: reportPeriodLabel(report),
          periodEnd: reportPeriodEnd(report),
          canOpen: true,
        },
        canEditFull,
        canEditAssigned: !canEditFull && assignedIds.has(task.id),
      });
    }
  }

  for (const assignedTask of assignedTasks) {
    if (seenIds.has(assignedTask.id)) continue; // already covered by a full report above -- see this function's own doc comment.
    entries.push({
      task: assignedTaskToTask(assignedTask),
      source: {
        reportId: assignedTask.reportId,
        kind: assignedTask.reportKind,
        periodLabel: assignedPeriodLabel(assignedTask),
        periodEnd: assignedPeriodEnd(assignedTask),
        canOpen: false,
      },
      canEditFull: false,
      canEditAssigned: true,
    });
  }

  return entries;
}

/**
 * Same status-grouping/sort convention `lib/view-utils.ts`'s
 * `groupTasksByStatus`/`compareEntries` use (Blocked -> In Progress ->
 * Complete, each group most-recent-period-end first, then soonest deadline)
 * -- re-implemented here (not imported) because it sorts by
 * `source.periodEnd`, not a full `report.weekEnd`: a `MergedTaskEntry` may
 * have no full report behind it at all (see `TaskSourceRef`'s own doc
 * comment).
 */
export function groupMergedTasksByStatus(entries: MergedTaskEntry[]): Record<TaskStatus, MergedTaskEntry[]> {
  const grouped: Record<TaskStatus, MergedTaskEntry[]> = { Blocked: [], 'In Progress': [], Complete: [] };
  for (const entry of entries) grouped[entry.task.status].push(entry);
  for (const status of TASK_STATUS_ORDER) {
    grouped[status].sort(
      (a, b) => b.source.periodEnd.localeCompare(a.source.periodEnd) || a.task.deadline.localeCompare(b.task.deadline)
    );
  }
  return grouped;
}
