// Phase 3 (Task + Calendar views) derivation selectors. Pure functions over
// `Report[]` -- no new storage, nothing here reads/writes localStorage or
// the repository. Written so they extend cleanly once daily reports (Phase
// 4) exist: `TaskEntry` already carries the *parent report*, not just the
// task, so a future daily-report source can be flattened into the same
// shape; `reportsOverlappingRange` takes a plain `[startISO, endISO]` range
// rather than assuming "week", so a daily report (weekStart === weekEnd)
// overlaps a calendar range the exact same way a weekly one does.

import type { Report, Task, TaskStatus } from './types';

export interface TaskEntry {
  report: Report;
  task: Task;
}

/** Kanban column / List-mode group order (see CLAUDE.md "Done means" #2). */
export const TASK_STATUS_ORDER: TaskStatus[] = ['Blocked', 'In Progress', 'Complete'];

/** Flattens every report's tasks into `{report, task}` pairs, report order preserved. */
export function allTasks(reports: Report[]): TaskEntry[] {
  return reports.flatMap((report) => report.tasks.map((task) => ({ report, task })));
}

function compareEntries(a: TaskEntry, b: TaskEntry): number {
  // Columns derive their own order (no persisted intra-column order):
  // most-recently-ended report first, then soonest deadline within that.
  const byWeekEnd = b.report.weekEnd.localeCompare(a.report.weekEnd);
  if (byWeekEnd !== 0) return byWeekEnd;
  return a.task.deadline.localeCompare(b.task.deadline);
}

/** Groups `entries` by task status, in `TASK_STATUS_ORDER`, each group sorted by `compareEntries`. */
export function groupTasksByStatus(entries: TaskEntry[]): Record<TaskStatus, TaskEntry[]> {
  const grouped: Record<TaskStatus, TaskEntry[]> = { Blocked: [], 'In Progress': [], Complete: [] };
  for (const entry of entries) {
    grouped[entry.task.status].push(entry);
  }
  for (const status of TASK_STATUS_ORDER) {
    grouped[status].sort(compareEntries);
  }
  return grouped;
}

/**
 * Reports whose `[weekStart, weekEnd]` span overlaps `[startISO, endISO]`.
 * String comparison only (ISO strings sort lexicographically, same as every
 * other date comparison in this codebase -- see CLAUDE.md "Conventions").
 */
export function reportsOverlappingRange(reports: Report[], startISO: string, endISO: string): Report[] {
  return reports.filter((r) => r.weekStart.localeCompare(endISO) <= 0 && r.weekEnd.localeCompare(startISO) >= 0);
}
