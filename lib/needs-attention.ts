// Home "Needs Attention" derivation (Navigation IA restructure follow-up --
// see CLAUDE.md's Home overview section). Pure, `today` passed in (an ISO
// string, `nowDate()` at the call site) -- no `Date`-based math, no storage
// -- style matches lib/view-utils.ts / lib/task-schedule.ts.
//
// Unlike `/tasks` (weekly-only, see CLAUDE.md "Task and Calendar views
// (Phase 3)"'s own "Dailies aren't surfaced here yet" note), Home is the one
// place BOTH weekly and daily reports' open tasks show up together --
// `attentionTasks` below takes both lists directly, rather than the single
// weekly-only `Report[]` `lib/view-utils.ts`'s `allTasks` accepts.
//
// Deliberately NOT deduped across reports (e.g. the same real-world blocker
// reported day after day in a run of daily reports shows up once PER
// report): this mirrors `/tasks`' own List view (`allTasks`/
// `groupTasksByStatus` in lib/view-utils.ts), where a task is a per-report
// record, not a single row in some central tracked-task table -- see
// lib/task-schedule.ts's header comment for the one place this codebase
// DOES stitch same-named tasks across reports into a single chain (the
// Schedule view), which is an intentionally different, heavier-weight
// question ("was this delivered on time") than "what's open right now".

import type { AnyReport, DailyReport, Task, WeeklyReport } from './types';

export interface AttentionEntry {
  /** The report this task record lives on -- what a clicked row navigates to (`/reports/[id]` or `/daily/[id]`, keyed off `report.kind`). */
  report: AnyReport;
  task: Task;
  /** `task.deadline` is non-empty AND has already passed `today` -- ISO string compare only, never `Date` math (CLAUDE.md "Conventions"). A task with no recorded deadline is never marked overdue. */
  overdue: boolean;
}

/**
 * Every `Blocked` or `In Progress` task across `weeklies` + `dailies` --
 * `Complete` tasks are never included (CLAUDE.md's decided scope for this
 * list). Ordered Blocked first, then In Progress (the decided group order);
 * within each status group, the earliest deadline sorts first (the most
 * time-critical task leads), with a task carrying no deadline at all
 * sorting to the END of its group -- a missing deadline isn't itself
 * urgent, so it shouldn't crowd out ones that ARE dated.
 */
export function attentionTasks(weeklies: WeeklyReport[], dailies: DailyReport[], today: string): AttentionEntry[] {
  const reports: AnyReport[] = [...weeklies, ...dailies];
  const entries: AttentionEntry[] = [];
  for (const report of reports) {
    for (const task of report.tasks) {
      if (task.status === 'Complete') continue;
      entries.push({ report, task, overdue: Boolean(task.deadline) && task.deadline.localeCompare(today) < 0 });
    }
  }
  entries.sort((a, b) => {
    // Status differs (the only two statuses reachable here, `Complete`
    // already filtered above): Blocked always sorts before In Progress,
    // regardless of either task's deadline.
    if (a.task.status !== b.task.status) return a.task.status === 'Blocked' ? -1 : 1;
    if (!a.task.deadline && !b.task.deadline) return 0;
    if (!a.task.deadline) return 1;
    if (!b.task.deadline) return -1;
    return a.task.deadline.localeCompare(b.task.deadline);
  });
  return entries;
}
