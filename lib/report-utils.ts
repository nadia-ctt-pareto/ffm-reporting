// Ported verbatim from design-source/original-dashboard.dc.html script block:
// ffOnSchedule/ffOpenBlockers (428-429), tone mappers (441-443),
// ffBlankDraft (445-448), validateStep (530-536).
//
// Phase 4 additions: blankDailyDraft(), a kind-aware validateStep() (daily
// step 1 also rejects a date that collides with an existing daily, see
// dailyDateConflict), and reportPeriodLabel/draftPeriodLabel/reportPeriodEnd
// -- the single place every screen (list, wizard, report, deck, CSV) goes to
// turn an AnyReport/Draft's period into display text or a sort key, so
// "weekly -> fmtWeekLabel" / "daily -> fmtDateShort" never has to be
// re-decided at each call site.

import { fmtDateShort, fmtWeekLabel } from './format';
import type { AnyReport, BadgeTone, DailyReport, Draft, ReportCore, RiskSeverity, ReportStatus, Task, TaskStatus } from './types';

/** Line 428 */
export function onSchedule(report: Pick<ReportCore, 'tasks'>): { onSched: number; total: number } {
  const total = report.tasks.length;
  const onSched = report.tasks.filter((t) => t.status !== 'Blocked').length;
  return { onSched, total };
}

/** Line 429 */
export function openBlockers(report: Pick<ReportCore, 'tasks'>): number {
  return report.tasks.filter((t) => t.status === 'Blocked').length;
}

/**
 * Line 441. NOTE: returns 'green' for 'Final' -- there is no 'green' tone in
 * Badge's style map, so "Final" badges render as 'neutral'. Faithful port of
 * a prototype quirk; see the BadgeTone comment in lib/types.ts.
 */
export function statusTone(status: ReportStatus): BadgeTone {
  return status === 'Sent' ? 'dark' : status === 'Final' ? 'green' : 'sage';
}

/** Line 442 */
export function taskTone(status: TaskStatus): BadgeTone {
  return status === 'Complete' ? 'positive' : status === 'Blocked' ? 'negative' : 'sage';
}

/** Line 443 */
export function riskTone(severity: RiskSeverity): BadgeTone {
  return severity === 'Blocked' ? 'negative' : 'warning';
}

/** Lines 445-448 */
export function blankDraft(): Draft {
  return {
    id: null,
    kind: 'weekly',
    weekStart: '',
    weekEnd: '',
    date: '',
    preparedFor: 'Christene, Founder',
    preparedBy: 'Jordan Reyes, Project Manager',
    summaryNarrative: '',
    status: 'Draft',
    tasks: [],
    touchpoints: { calls: 0, emails: 0, escalations: 0, narrative: '' },
    win: { stat: '', label: '', narrative: '' },
    risks: [],
    priorities: [],
  };
}

/** Phase 4: the daily-report sibling of blankDraft() -- same defaults, `kind: 'daily'`, no week fields. */
export function blankDailyDraft(): Draft {
  return { ...blankDraft(), kind: 'daily', weekStart: '', weekEnd: '' };
}

/**
 * Task completion date: the SINGLE place the auto-stamp/clear rule lives, so
 * it cannot drift between the three status-change write paths (the wizard's
 * Status select via `useWizard.ts`'s `updateTask`, the task modal via
 * `withTaskEdited` AND its own live Select handler in `TaskDialog.tsx`, and
 * a Kanban drag via `withTaskStatus`). Pure: `today` is passed in
 * (`nowDate()` at every call site), never read inside.
 *
 * - transitioning TO `'Complete'` with no `completedAt` already recorded ->
 *   `today`.
 * - transitioning AWAY from `'Complete'` -> `''` (cleared).
 * - already `'Complete'` and STAYING `'Complete'` -> unchanged, whatever is
 *   already there (never clobbers a manual correction the user made via the
 *   task modal's "Completed On" field).
 */
export function taskCompletionStamp(current: Pick<Task, 'status' | 'completedAt'>, nextStatus: TaskStatus, today: string): string {
  if (nextStatus !== 'Complete') return '';
  if (current.status === 'Complete') return current.completedAt || '';
  return current.completedAt || today;
}

/**
 * Phase 3 (Task view Kanban). Pure helper: returns a new `tasks` array with
 * the task matching `taskId` moved to `status` (no-op copy if not found).
 * Callers pass the result straight into `useReports().updateReportFields`
 * (which stamps a fresh `updatedAt` and persists) -- this function never
 * touches storage itself. `today` (`nowDate()` at the call site) drives
 * `taskCompletionStamp` above -- this is what makes a Kanban drag to the
 * Complete column stamp `completedAt` "for free", and a drag back OFF it
 * clear the stamp, with zero extra code at the drag-handler call site.
 */
export function withTaskStatus(report: Pick<ReportCore, 'tasks'>, taskId: string, status: TaskStatus, today: string): Task[] {
  return report.tasks.map((t) => (t.id === taskId ? { ...t, status, completedAt: taskCompletionStamp(t, status, today) } : t));
}

/**
 * `/tasks` task CRUD (click-to-edit). Pure helper mirroring `withTaskStatus`
 * exactly, generalized from a single `status` field to an arbitrary
 * `Partial<Task>` patch: returns a NEW `tasks` array with the task matching
 * `taskId` shallow-merged with `patch` (a no-op copy -- same array contents,
 * fresh outer array reference -- if `taskId` isn't found, matching
 * `withTaskStatus`'s own no-op behavior). Never touches storage; `TaskDialog`
 * calls this to build the array it hands to
 * `useReports().updateReportFields(reportId, { tasks })`, the exact same
 * write path the Kanban drag handler already uses.
 *
 * Task completion date: when `patch.status` changes the task's status, the
 * same `taskCompletionStamp` rule applies -- UNLESS `patch` already carries
 * its own explicit `completedAt` (as `TaskDialog`'s Save always does, having
 * already computed one via its own live Select handler using the identical
 * shared function -- see that component), in which case the caller's value
 * wins outright. This keeps the rule enforced even for a hypothetical future
 * caller that changes `status` without separately computing `completedAt`
 * itself, without ever overriding a value the caller deliberately supplied.
 */
export function withTaskEdited(report: Pick<ReportCore, 'tasks'>, taskId: string, patch: Partial<Task>, today: string): Task[] {
  return report.tasks.map((t) => {
    if (t.id !== taskId) return t;
    if (patch.status === undefined || patch.status === t.status) return { ...t, ...patch };
    const completedAt = patch.completedAt !== undefined ? patch.completedAt : taskCompletionStamp(t, patch.status, today);
    return { ...t, ...patch, completedAt };
  });
}

/**
 * `/tasks` task CRUD. Pure helper: returns a NEW `tasks` array with the task
 * matching `taskId` removed (a no-op copy -- identical contents, fresh outer
 * array -- if `taskId` isn't found). Never touches storage; see
 * `withTaskEdited`'s doc comment for the write path this feeds.
 */
export function withTaskRemoved(report: Pick<ReportCore, 'tasks'>, taskId: string): Task[] {
  return report.tasks.filter((t) => t.id !== taskId);
}

/**
 * `/tasks` task CRUD. Pure helper: returns a NEW `tasks` array with `task`
 * appended. The caller is responsible for minting `task.id` (via `uid('t')`,
 * the same prefix `components/wizard/useWizard.ts`'s `addTask` uses) --
 * this function never mints ids itself, mirroring `withTaskEdited`/
 * `withTaskRemoved`'s "pure array transform only" scope. Never touches
 * storage; see `withTaskEdited`'s doc comment for the write path this feeds.
 */
export function withTaskAdded(report: Pick<ReportCore, 'tasks'>, task: Task): Task[] {
  return [...report.tasks, task];
}

/** Phase 4: the display label for an AnyReport's period -- "Week of ..." for weekly, a short date for daily. Used by lists, the wizard's import panels, the report screen/deck, and CSV export. */
export function reportPeriodLabel(report: AnyReport): string {
  return report.kind === 'weekly' ? fmtWeekLabel(report.weekStart, report.weekEnd) : fmtDateShort(report.date);
}

// Phase 8d (report delete): `DELETE_REPORT_HINT` moved to lib/report-access.ts, so
// the hint text sits directly beside `canDeleteReport` -- the rule and the
// sentence explaining it to the user must not live in separate modules where
// one can be changed without the other.

/** Phase 4: same as reportPeriodLabel, but for an in-progress Draft (which always carries both weekStart/weekEnd and date, using whichever the draft's `kind` calls for). */
export function draftPeriodLabel(draft: Draft): string {
  return draft.kind === 'weekly' ? fmtWeekLabel(draft.weekStart, draft.weekEnd) : fmtDateShort(draft.date);
}

/**
 * Phase 8a: promoted out of `components/wizard/useWizard.ts` (a pure
 * function had no business living in a `'use client'` hook module -- Phase
 * 8's `create_weekly_from_dailies` MCP tool needs this exact assembly logic
 * server-side, and duplicating it there would risk the wizard and the MCP
 * tool silently drifting apart on what "build a report from a draft" means).
 * `useWizard.ts` now imports this back, unchanged -- see its own
 * `saveDraft`/`publish`, which are the only call sites this move had to stay
 * byte-identical for.
 *
 * The inverse of `reportToDraft` (still private to useWizard.ts, since
 * nothing outside the wizard resumes a saved report INTO a Draft): builds
 * the `AnyReport` to persist from a Draft, an id, and a status. Only the
 * fields relevant to `draft.kind` are carried into the result. `projectId`
 * must be carried explicitly here (unlike `reportToDraft`, which gets it for
 * free via its `{...report}` spread) -- otherwise resuming an imported
 * draft-status report through the wizard would silently strip its project on
 * the next save.
 */
export function draftToReport(draft: Draft, id: string, status: ReportStatus, now: string): AnyReport {
  const core = {
    id,
    status,
    preparedFor: draft.preparedFor,
    preparedBy: draft.preparedBy,
    createdAt: draft.createdAt || now,
    updatedAt: now,
    summaryNarrative: draft.summaryNarrative,
    tasks: draft.tasks,
    risks: draft.risks,
    win: draft.win,
    touchpoints: draft.touchpoints,
    priorities: draft.priorities,
    projectId: draft.projectId,
  };
  return draft.kind === 'daily'
    ? { ...core, kind: 'daily', date: draft.date }
    : { ...core, kind: 'weekly', weekStart: draft.weekStart, weekEnd: draft.weekEnd };
}

/** Phase 4: the ISO string to sort/compare an AnyReport's period by (weekEnd for weekly, date for daily) -- both are ISO strings, so plain `localeCompare` stays correct (see CLAUDE.md "Conventions"). */
export function reportPeriodEnd(report: AnyReport): string {
  return report.kind === 'weekly' ? report.weekEnd : report.date;
}

/**
 * Phase 6a: the TS mirror of SQL's `coalesce(project_id, '')` -- two
 * `projectId`s are in the "same bucket" if they're equal once `null`/
 * `undefined` are folded to `''` (the house bucket). Powers the
 * per-project-bucket daily-uniqueness scoping below: `(null, null)` collide
 * (both house), `('p1', 'p1')` collide (same project), `(null, 'p1')` and
 * `('p1', 'p2')` never collide.
 */
export function sameProjectBucket(a?: string | null, b?: string | null): boolean {
  return (a ?? '') === (b ?? '');
}

/**
 * Phase 4: true when `draft` is a daily report whose `date` matches an
 * existing daily OTHER than itself (`id !== draft.id`, so editing an
 * existing daily in place is never flagged against its own prior save).
 * Enforces "one daily report per day, covering all clients" in the UI --
 * mirrored in SQL by the `reports_one_daily_per_day` partial unique index
 * (supabase/migrations/20260717000002_daily_reports.sql). Phase 6a: scoped
 * per project bucket (`sameProjectBucket`) -- a wizard-created draft always
 * has no `projectId` (house bucket), so this is a no-op behavior change for
 * every existing flow; it only stops colliding with imported project-scoped
 * dailies (supabase/migrations/20260718000003_projects.sql).
 */
export function dailyDateConflict(draft: Draft, existingDailies: DailyReport[]): boolean {
  if (draft.kind !== 'daily' || !draft.date) return false;
  return existingDailies.some((d) => d.date === draft.date && sameProjectBucket(d.projectId, draft.projectId) && d.id !== draft.id);
}

/**
 * Phase 4: the report-screen-edit cousin of dailyDateConflict, for
 * `/daily/[id]`'s inline, autosaving Date field (which has no wizard-style
 * "Next" gate to catch a bad value before it's persisted). True when `date`
 * is blank OR collides with another daily's date in the SAME project bucket
 * (excluding `id` itself) -- both cases must be rejected before the patch
 * reaches `useDailyReports().updateReportFields`, or the one-daily-per-day
 * invariant (`reports_one_daily_per_day` in SQL) can be silently violated
 * via this edit path alone. Phase 6a: `projectId` defaults to `null` (house
 * bucket) so every pre-Phase-6a call site is unaffected.
 */
export function invalidDailyDateEdit(existingDailies: DailyReport[], id: string, date: string, projectId?: string | null): boolean {
  return !date || existingDailies.some((d) => d.date === date && sameProjectBucket(d.projectId, projectId) && d.id !== id);
}

/**
 * Lines 530-536. Used by the wizard (Pass 2); defined now so the contract
 * exists for both passes. Phase 4: step 1 branches on `draft.kind` (a
 * single `date` for daily vs. `weekStart`/`weekEnd` for weekly) and, for
 * daily drafts, also rejects a date collision via dailyDateConflict()
 * (`existingDailies` is only consulted for that check -- pass `[]` from any
 * weekly call site, it's a no-op there). Step 5's error copy is also
 * kind-aware ("next week" only makes sense for a weekly draft) -- steps 2-4
 * are identical for both kinds.
 */
export function validateStep(step: number, draft: Draft, existingDailies: DailyReport[] = []): string {
  if (step === 1) {
    if (draft.kind === 'daily') {
      if (!draft.date) return 'Enter the report date.';
      if (dailyDateConflict(draft, existingDailies)) return 'A daily report for this date already exists.';
    } else {
      if (!draft.weekStart || !draft.weekEnd) return 'Enter the week start and end dates.';
    }
    if (!draft.preparedFor.trim()) return 'Enter who this report is prepared for.';
  }
  if (step === 2) {
    if (draft.tasks.length === 0) return 'Add at least one task before continuing.';
  }
  if (step === 5) {
    if (draft.priorities.length === 0) {
      return draft.kind === 'daily' ? 'Add at least one priority.' : "Add at least one priority for next week.";
    }
  }
  return '';
}
