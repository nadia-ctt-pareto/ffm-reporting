// Home "Needs Attention" derivation (Navigation IA restructure follow-up --
// see CLAUDE.md's Home overview section). Pure, `today` passed in (an ISO
// string, `nowDate()` at the call site) -- no `Date`-based math, no storage
// -- style matches lib/view-utils.ts / lib/task-schedule.ts.
//
// WP4 (the access flip's task-surface follow-up): this now reads off the
// SHARED `MergedTaskEntry[]` (lib/task-merge.ts) instead of taking
// `weeklies`/`dailies` directly -- Home's own `HomePage` builds that merged
// set once (weeklies + dailies + the viewer's assigned-elsewhere tasks) and
// every task-centric surface, this one included, derives from it. This is
// also what makes Home the one surface where an assigned-elsewhere task
// (one living in a report the viewer can't open at all) shows up alongside
// everything else -- see `MergedTaskEntry.source.canOpen`, which
// `HomeScreen.tsx` reads to decide whether a row gets a "View Report" link.
//
// Deliberately NOT deduped across reports (e.g. the same real-world blocker
// reported day after day in a run of daily reports shows up once PER
// report): this mirrors `/tasks`' own List view, where a task is a
// per-report record, not a single row in some central tracked-task table --
// see lib/task-schedule.ts's header comment for the one place this codebase
// DOES stitch same-named tasks across reports into a single chain (the
// Schedule view), which is an intentionally different, heavier-weight
// question ("was this delivered on time") than "what's open right now".

import type { MergedTaskEntry } from './task-merge';

export interface AttentionEntry {
  entry: MergedTaskEntry;
  /** `task.deadline` is non-empty AND has already passed `today` -- ISO string compare only, never `Date` math (CLAUDE.md "Conventions"). A task with no recorded deadline is never marked overdue. */
  overdue: boolean;
}

/**
 * Every `Blocked` or `In Progress` task in `entries` -- `Complete` tasks are
 * never included (CLAUDE.md's decided scope for this list). Ordered Blocked
 * first, then In Progress (the decided group order); within each status
 * group, the earliest deadline sorts first (the most time-critical task
 * leads), with a task carrying no deadline at all sorting to the END of its
 * group -- a missing deadline isn't itself urgent, so it shouldn't crowd
 * out ones that ARE dated.
 */
export function attentionTasks(entries: MergedTaskEntry[], today: string): AttentionEntry[] {
  const result: AttentionEntry[] = [];
  for (const entry of entries) {
    if (entry.task.status === 'Complete') continue;
    result.push({ entry, overdue: Boolean(entry.task.deadline) && entry.task.deadline.localeCompare(today) < 0 });
  }
  result.sort((a, b) => {
    // Status differs (the only two statuses reachable here, `Complete`
    // already filtered above): Blocked always sorts before In Progress,
    // regardless of either task's deadline.
    if (a.entry.task.status !== b.entry.task.status) return a.entry.task.status === 'Blocked' ? -1 : 1;
    if (!a.entry.task.deadline && !b.entry.task.deadline) return 0;
    if (!a.entry.task.deadline) return 1;
    if (!b.entry.task.deadline) return -1;
    return a.entry.task.deadline.localeCompare(b.entry.task.deadline);
  });
  return result;
}
