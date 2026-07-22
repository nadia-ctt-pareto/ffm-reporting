// Schedule view (`/tasks?view=schedule`): a pure derivation over weekly
// `Report[]` -- no React, no storage, nothing here reads/writes localStorage
// or the repository. Style mirrors `lib/project-view.ts`: a plain module of
// functions, callers (`TaskScheduleView.tsx`) pass in whatever `useReports()`
// already loaded.
//
// THE PROBLEM THIS SOLVES
// ------------------------
// `Task` (lib/schema/report.ts) has no `completedAt`, no status-change
// history, and no task<->risk link -- a single task row only ever records
// its CURRENT status and CURRENT deadline. So "was this task delivered on
// time, and why not" cannot be read off one row. It has to be INFERRED from
// how the same logical task's status changed across every weekly report it
// appears in, ordered by that report's period end. This module is exactly
// that inference, and nothing else -- it never mutates a report, never
// invents a completion date that wasn't actually reported, and (see
// `completed-timing-unclear` below) refuses to guess precision the source
// data doesn't have.
//
// IDENTITY: SAME KEY `lib/aggregate.ts` ALREADY USES
// ---------------------------------------------------
// A task's identity across reports is `(client, task-text)`, via
// `taskKey()` imported from `lib/aggregate.ts` -- the exact predicate that
// module's carry-forward/import dedupe already relies on. Reusing it (not
// re-deriving a second, subtly different notion of "the same task") means
// this view and consolidation/import can never silently disagree about
// what counts as one task's history. The direct consequence, and the
// second honest caveat this view surfaces in its UI: renaming a task's
// title (or its client) starts a brand-new chain from that point on -- this
// module has no way to know it's "the same task, renamed".
//
// TWO HONEST CAVEATS (surfaced in the UI, not just here)
// --------------------------------------------------------
// 1. Weekly reporting resolves to a WEEK, not a day. All this module ever
//    knows about "when" a task was first reported complete is the
//    `[weekStart, weekEnd]` of the report that first said so. If a task's
//    deadline falls inside that same week, there is genuinely no way to
//    tell whether it landed before or after that day -- see
//    `completed-timing-unclear` below, which exists specifically so this
//    view says "we don't know" instead of guessing.
// 2. Identity is `(client, task text)` -- see above.
//
// Dates are ISO strings, compared with `localeCompare` -- never `Date`
// math (CLAUDE.md "Conventions"). `today` is passed in by the caller
// (`nowDate()`, mirroring `CalendarScreen`'s own precedent), never read
// inside this module, so every function here stays a pure, deterministic
// function of its arguments and is trivially testable without mocking the
// clock.

import { taskKey } from './aggregate';
import { fmtDateShort } from './format';
import { reportPeriodEnd } from './report-utils';
import type { Report, Task, TaskStatus } from './types';

/** One report's recorded state of a logical task, in report-period order. */
export interface TaskOccurrence {
  report: Report;
  task: Task;
}

export type ScheduleBucket =
  | 'no-deadline'
  | 'on-track'
  | 'overdue-blocked'
  | 'overdue-unresolved'
  | 'completed-on-time'
  | 'completed-late-after-block'
  | 'completed-late'
  | 'completed-timing-unclear';

/** One logical task's full inferred schedule status. */
export interface ScheduledTask {
  /** `(client, task-text)` -- see this file's header comment. Stable across occurrences by construction (it IS the grouping key). */
  key: string;
  client: string;
  task: string;
  /** From the most recent occurrence that recorded one (a later report is the more current statement of the deadline) -- `''` when no occurrence ever recorded one. */
  deadline: string;
  /** The most recent occurrence's status. */
  currentStatus: TaskStatus;
  bucket: ScheduleBucket;
  /** Human-readable, shown verbatim in the UI -- the whole reason this view is trustworthy rather than a black box (see CLAUDE.md's task-schedule instructions). */
  evidence: string;
  /** Every occurrence, oldest first. */
  occurrences: TaskOccurrence[];
  /** The most recent occurrence's report -- what the table's "View Report" link points at. */
  latestReport: Report;
}

/** Canonical bucket order: Open, then Completed, then No Deadline -- matches the tile grouping in `TaskScheduleView.tsx`. */
export const BUCKET_ORDER: ScheduleBucket[] = [
  'on-track',
  'overdue-blocked',
  'overdue-unresolved',
  'completed-on-time',
  'completed-late-after-block',
  'completed-late',
  'completed-timing-unclear',
  'no-deadline',
];

/** Short tile/table labels, one per bucket. */
export const BUCKET_LABELS: Record<ScheduleBucket, string> = {
  'on-track': 'On Track',
  'overdue-blocked': 'Overdue & Blocked',
  'overdue-unresolved': 'Overdue',
  'completed-on-time': 'Completed On Time',
  'completed-late-after-block': 'Completed Late (After a Block)',
  'completed-late': 'Completed Late',
  'completed-timing-unclear': 'Timing Unclear',
  'no-deadline': 'No Deadline',
};

/** Groups the tile row into the three headings the Schedule view reads as: Open / Completed / No Deadline. */
export const BUCKET_GROUPS: { heading: string; buckets: ScheduleBucket[] }[] = [
  { heading: 'Open', buckets: ['on-track', 'overdue-blocked', 'overdue-unresolved'] },
  {
    heading: 'Completed',
    buckets: ['completed-on-time', 'completed-late-after-block', 'completed-late', 'completed-timing-unclear'],
  },
  { heading: 'No Deadline', buckets: ['no-deadline'] },
];

function weekEndLabel(report: Report): string {
  return fmtDateShort(report.weekEnd);
}

/**
 * Builds every classified `ScheduledTask` out of `reports` (weekly-only --
 * `/tasks` stays weekly-only, see CLAUDE.md's "Task and Calendar views").
 * `today` is an ISO date string, normally `nowDate()`.
 */
export function buildTaskSchedule(reports: Report[], today: string): ScheduledTask[] {
  const byKey = new Map<string, TaskOccurrence[]>();
  for (const report of reports) {
    for (const task of report.tasks) {
      const key = taskKey(task);
      const list = byKey.get(key);
      if (list) list.push({ report, task });
      else byKey.set(key, [{ report, task }]);
    }
  }

  const scheduled: ScheduledTask[] = [];
  for (const [key, unsorted] of byKey) {
    // Ascending by report period end -- "later in the array" means "more
    // recent", the same convention `lib/aggregate.ts`'s `ordered` uses.
    const occurrences = [...unsorted].sort((a, b) => reportPeriodEnd(a.report).localeCompare(reportPeriodEnd(b.report)));
    scheduled.push(classify(key, occurrences, today));
  }
  return scheduled;
}

function classify(key: string, occurrences: TaskOccurrence[], today: string): ScheduledTask {
  const latest = occurrences[occurrences.length - 1];
  const currentStatus = latest.task.status;

  // Deadline: the most recent occurrence that actually recorded one -- scan
  // backward from the latest occurrence so a later report's deadline
  // (including a later report that CLEARED it back to blank, which this
  // scan correctly skips past to an earlier non-blank one) always wins.
  let deadline = '';
  for (let i = occurrences.length - 1; i >= 0; i -= 1) {
    if (occurrences[i].task.deadline) {
      deadline = occurrences[i].task.deadline;
      break;
    }
  }

  const firstCompleteIndex = occurrences.findIndex((o) => o.task.status === 'Complete');
  const firstCompleteOccurrence = firstCompleteIndex === -1 ? null : occurrences[firstCompleteIndex];

  // "blocked before completion": some occurrence with status Blocked sorts
  // strictly before the first-Complete occurrence -- or, when the task has
  // never been completed, any occurrence at all is/was Blocked (there is no
  // "before completion" boundary yet, so the whole history counts).
  const priorOccurrences = firstCompleteOccurrence ? occurrences.slice(0, firstCompleteIndex) : occurrences;
  const blockedBeforeCompletion = priorOccurrences.some((o) => o.task.status === 'Blocked');

  const { bucket, evidence } = classifyBucket({
    occurrences,
    latest,
    currentStatus,
    deadline,
    firstCompleteIndex,
    firstCompleteOccurrence,
    blockedBeforeCompletion,
    today,
  });

  return {
    key,
    client: latest.task.client,
    task: latest.task.task,
    deadline,
    currentStatus,
    bucket,
    evidence,
    occurrences,
    latestReport: latest.report,
  };
}

function classifyBucket(args: {
  occurrences: TaskOccurrence[];
  latest: TaskOccurrence;
  currentStatus: TaskStatus;
  deadline: string;
  firstCompleteIndex: number;
  firstCompleteOccurrence: TaskOccurrence | null;
  blockedBeforeCompletion: boolean;
  today: string;
}): { bucket: ScheduleBucket; evidence: string } {
  const { occurrences, latest, currentStatus, deadline, firstCompleteIndex, firstCompleteOccurrence, blockedBeforeCompletion, today } = args;

  // No deadline recorded, ever -- cannot be judged either way, regardless of
  // current status. This check runs FIRST and unconditionally: a deadline
  // is a precondition for every other bucket's comparison below.
  if (!deadline) {
    return {
      bucket: 'no-deadline',
      evidence: `No deadline recorded across ${occurrences.length} report${occurrences.length === 1 ? '' : 's'}; most recently reported ${currentStatus} w/e ${weekEndLabel(latest.report)}.`,
    };
  }

  // `deadline.localeCompare(...)` above/below stays on the raw ISO string
  // (CLAUDE.md's "Conventions"); `deadlineLabel` is only for display text.
  const deadlineLabel = fmtDateShort(deadline);

  if (currentStatus !== 'Complete') {
    if (deadline.localeCompare(today) >= 0) {
      return {
        bucket: 'on-track',
        evidence: `Reported ${currentStatus} w/e ${weekEndLabel(latest.report)}; deadline ${deadlineLabel} hasn't arrived yet.`,
      };
    }
    if (currentStatus === 'Blocked') {
      return {
        bucket: 'overdue-blocked',
        evidence: `Blocked w/e ${weekEndLabel(latest.report)}; deadline ${deadlineLabel} has passed.`,
      };
    }
    return {
      bucket: 'overdue-unresolved',
      evidence: `Reported ${currentStatus} w/e ${weekEndLabel(latest.report)}; deadline ${deadlineLabel} has passed and the task isn't marked Blocked.`,
    };
  }

  // currentStatus === 'Complete' from here on. `firstCompleteOccurrence` is
  // guaranteed non-null: `currentStatus` is the LATEST occurrence's status,
  // so if it's 'Complete', `findIndex` above found at least that one.
  const first = firstCompleteOccurrence!;
  const periodStart = first.report.weekStart;
  const periodEnd = first.report.weekEnd;

  if (periodEnd.localeCompare(deadline) <= 0) {
    return {
      bucket: 'completed-on-time',
      evidence: `First reported complete w/e ${weekEndLabel(first.report)}, on or before the ${deadlineLabel} deadline.`,
    };
  }

  if (periodStart.localeCompare(deadline) > 0) {
    if (blockedBeforeCompletion) {
      // The most recent Blocked occurrence strictly before completion --
      // the one most directly explaining the delay.
      const blockedOccurrence = [...occurrences.slice(0, firstCompleteIndex)].reverse().find((o) => o.task.status === 'Blocked');
      return {
        bucket: 'completed-late-after-block',
        evidence: `Blocked w/e ${blockedOccurrence ? weekEndLabel(blockedOccurrence.report) : '?'} · first reported complete w/e ${weekEndLabel(first.report)} · deadline ${deadlineLabel}`,
      };
    }
    return {
      bucket: 'completed-late',
      evidence: `First reported complete w/e ${weekEndLabel(first.report)} · deadline ${deadlineLabel} had already passed before that reporting period even started.`,
    };
  }

  // Neither on-time nor late: the deadline falls INSIDE the reporting
  // period the task was first reported complete in. Weekly reporting only
  // tells us the WEEK, not the day -- see this file's header comment. This
  // is the intellectually honest bucket: guessing on-time or late here
  // would fabricate precision the source data doesn't have.
  return {
    bucket: 'completed-timing-unclear',
    evidence: `Deadline ${deadlineLabel} falls inside the w/e ${weekEndLabel(first.report)} reporting period the task was first marked complete in -- weekly reporting can't tell which day within that week it actually landed.`,
  };
}

/** Groups `scheduled` by bucket, each group sorted most-recent-report-first, then soonest-deadline -- same convention `lib/view-utils.ts`'s `groupTasksByStatus` uses. */
export function groupScheduleByBucket(scheduled: ScheduledTask[]): Record<ScheduleBucket, ScheduledTask[]> {
  const grouped: Record<ScheduleBucket, ScheduledTask[]> = {
    'on-track': [],
    'overdue-blocked': [],
    'overdue-unresolved': [],
    'completed-on-time': [],
    'completed-late-after-block': [],
    'completed-late': [],
    'completed-timing-unclear': [],
    'no-deadline': [],
  };
  for (const s of scheduled) grouped[s.bucket].push(s);
  for (const bucket of BUCKET_ORDER) {
    grouped[bucket].sort((a, b) => b.latestReport.weekEnd.localeCompare(a.latestReport.weekEnd) || a.deadline.localeCompare(b.deadline));
  }
  return grouped;
}

/** Type guard for `?filter=<bucket>` deep-linking (`TaskViewScreen.tsx`). */
export function isScheduleBucket(value: string | null): value is ScheduleBucket {
  return value !== null && (BUCKET_ORDER as string[]).includes(value);
}
