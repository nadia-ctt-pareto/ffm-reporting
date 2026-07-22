// WP6 (My Week / My Day export): pure derivation + synthetic-report
// composition shared by `/my-week` (components/my-week/MyWeekScreen.tsx) and
// its print route `/my-week/present` (components/my-week/MyWeekPresentScreen.tsx)
// -- the ONE place both screens decide what counts as "this week"/"this day,"
// what "Mine" vs. "Everyone" means, and how a synthetic export report is
// assembled, so the on-screen preview and the printed PDF can never
// independently drift on either question. No React, no storage -- same
// discipline as lib/view-utils.ts / lib/task-calendar.ts / lib/project-view.ts.
//
// COMPOSE, NEVER MODIFY: `buildSyntheticReport` below reads real,
// already-persisted reports (`sources`) but never mutates them, never mints
// a real repository id, and its output is never handed to
// `getReportsRepository()` -- the synthetic report exists only in the memory
// of whichever tab is rendering it, for exactly as long as that tab stays
// open. Nothing here can ever cause a synthetic report to appear in
// `ff.reports.v2` (localStorage) or the Postgres `reports` table.

import { aggregateReportsIntoDraft } from './aggregate';
import { canEditReport } from './report-access';
import type { ReportAccessContext } from './report-access';
import { blankDailyDraft, blankDraft, draftToReport } from './report-utils';
import type { AnyReport, AssignedTask, Draft, ReportKind, Task } from './types';

/**
 * 'mine' = the viewer's own reports (owner-only, see `filterReportsByScope`)
 * plus tasks they own or are assigned, via the WP4 merged set. 'everyone' =
 * every report the viewer's own session can already read -- org-wide for
 * pm+, unchanged (still owner-only in effect) for a plain member, per
 * `reports_select` (supabase/migrations/20260726000018_scoped_access.sql).
 * The scope toggle that sets this is rendered only for `hasRoleAtLeast(user,
 * 'pm')` (lib/roles.ts) -- for anyone else it stays 'mine' unconditionally,
 * which is a no-op given what "everyone" already degrades to for them (see
 * `filterReportsByScope`'s own doc comment).
 */
export type MyWeekScope = 'mine' | 'everyone';

/**
 * True when `report`'s own period overlaps `[startISO, endISO]` --
 * generalizes `lib/view-utils.ts`'s weekly-only `reportsOverlappingRange` to
 * `AnyReport`: a weekly compares its `[weekStart, weekEnd]` span (identical
 * ISO-string-compare contract, CLAUDE.md "Conventions"); a daily compares its
 * single `date` against the range. A single-day range (`startISO ===
 * endISO`, the day drill-down) falls out of the SAME comparison with no
 * special case -- a weekly whose span includes that one day still overlaps;
 * a daily dated exactly that day still overlaps.
 */
export function reportOverlapsRange(report: AnyReport, startISO: string, endISO: string): boolean {
  if (report.kind === 'weekly') {
    return report.weekStart.localeCompare(endISO) <= 0 && report.weekEnd.localeCompare(startISO) >= 0;
  }
  return report.date.localeCompare(startISO) >= 0 && report.date.localeCompare(endISO) <= 0;
}

/** `reports` (weeklies and dailies mixed) restricted to those overlapping `[startISO, endISO]` -- see `reportOverlapsRange`. */
export function reportsInRange(reports: AnyReport[], startISO: string, endISO: string): AnyReport[] {
  return reports.filter((r) => reportOverlapsRange(r, startISO, endISO));
}

/**
 * The same overlap contract as `reportOverlapsRange`, applied to an
 * `AssignedTask`'s own bounded parent-report period (WP3's
 * `list_assigned_tasks()` bridge, lib/hooks/useAssignedTasks.ts) -- decides
 * whether a task visible to the viewer ONLY via that bridge (a report they
 * can't otherwise open at all) belongs in this week/day's digest. A row
 * missing its own period field for its `reportKind` (never happens for a
 * well-formed RPC result, see `AssignedTask`'s own doc comment) is treated as
 * NOT overlapping -- excluding an ambiguous row is the safe direction for an
 * export, not silently including it under a guessed date.
 */
export function assignedTaskOverlapsRange(t: AssignedTask, startISO: string, endISO: string): boolean {
  if (t.reportKind === 'weekly') {
    if (!t.weekStart || !t.weekEnd) return false;
    return t.weekStart.localeCompare(endISO) <= 0 && t.weekEnd.localeCompare(startISO) >= 0;
  }
  if (!t.date) return false;
  return t.date.localeCompare(startISO) >= 0 && t.date.localeCompare(endISO) <= 0;
}

/**
 * `reports` narrowed to the viewer's OWN reports when `scope === 'mine'`;
 * unchanged (every report the caller's session already loaded -- org-wide
 * for pm+, owner-only for a plain member, per `reports_select`) when `scope
 * === 'everyone'`.
 *
 * Reuses `canEditReport` (lib/report-access.ts) as the "is this my report"
 * predicate rather than inventing a second one: WP3 made report ownership
 * and report-EDIT authority the identical owner-only rule (see that
 * function's own doc comment), and it already degrades to "everything is
 * mine" in demo mode (`!access.supabaseConfigured`) -- exactly the behavior
 * this module's own scope toggle needs there too (CLAUDE.md: "all local data
 * is yours"; the scope toggle itself is hidden in demo mode regardless,
 * since `hasRoleAtLeast(null, 'pm')` is always false there -- see
 * `MyWeekScope`'s own doc comment -- but this function stays correct even if
 * something upstream ever called it with `scope: 'mine'` unconditionally).
 *
 * `assignedTasks` (the bridge) is deliberately NOT narrowed by scope
 * anywhere in this module -- `useAssignedTasks()` already only ever returns
 * the CALLER's own assigned tasks (never someone else's), so it is already
 * "mine" by construction regardless of which scope the viewer picked. A
 * pm/admin viewing "Everyone" still only ever sees THEIR OWN assignments
 * through the bridge specifically; any teammate's assignment they can see at
 * all comes through the org-wide `reports` list instead, with its own
 * `canEditAssigned` flag from `mergeTaskSources` (lib/task-merge.ts).
 */
export function filterReportsByScope(reports: AnyReport[], scope: MyWeekScope, access: ReportAccessContext): AnyReport[] {
  if (scope === 'everyone') return reports;
  return reports.filter((r) => canEditReport(r, access));
}

export interface SyntheticReportInput {
  /** 'weekly' composes a My-Week digest (Monday-anchored week); 'daily' composes a My-Day digest (a single date). */
  kind: ReportKind;
  /** Weekly only. */
  weekStart?: string;
  /** Weekly only. */
  weekEnd?: string;
  /** Daily only. */
  date?: string;
  /**
   * Real, already-persisted reports (weeklies + dailies) already scoped
   * (Mine/Everyone) and range-filtered -- fed straight into
   * `aggregateReportsIntoDraft`. Read-only: never mutated, never
   * re-persisted.
   */
  sources: AnyReport[];
  /**
   * Tasks visible to the viewer ONLY via WP3's assignee bridge -- i.e. every
   * `MergedTaskEntry` in the caller's own `mergeTaskSources(sources, ...)`
   * result (lib/task-merge.ts) whose `source.canOpen` is false, already
   * converted to a plain `Task` by that same merge. Passing THIS (rather
   * than a raw `AssignedTask[]`) is what avoids double-counting a task
   * that's already inside `sources`, and reuses the one dedupe rule this
   * codebase already has for "is this task visible some other way" instead
   * of writing a second, independent one here.
   */
  bridgeOnlyTasks: Task[];
  preparedFor: string;
  preparedBy: string;
  /** ISO date stamped as both `createdAt`/`updatedAt` -- cosmetic only (never persisted, never compared against anything). */
  now: string;
}

/**
 * The stable, non-persisted id every synthetic My-Week/My-Day report
 * carries. Never a real repository id and never collides with one -- no
 * report is ever seeded or created with this literal id.
 */
export const SYNTHETIC_REPORT_ID = 'synthetic-my-week';

/**
 * Composes a synthetic, NEVER-PERSISTED `AnyReport` from `input` -- the
 * single place both `/my-week` and its print route (`/my-week/present`)
 * build the export, so the two can never independently drift on what "my
 * week"/"my day" means. Pure: never touches storage, never mutates
 * `input.sources`/`input.bridgeOnlyTasks`, mints no repository id.
 *
 * `blankDraft()`/`blankDailyDraft()` (lib/report-utils.ts) seed the shape;
 * `aggregateReportsIntoDraft` (lib/aggregate.ts, UNMODIFIED -- the exact
 * function `/consolidate` already uses to build a brand-new real report from
 * many sources) folds every source's tasks/risks/priorities/touchpoints/win
 * into it under this codebase's one, already-reviewed merge contract
 * (tasks/risks latest-wins, priorities first-wins, touchpoints summed, win
 * carried from the latest non-empty source). `bridgeOnlyTasks` is appended
 * AFTER aggregation, never through it -- `aggregateReportsIntoDraft` only
 * knows about full `AnyReport` sources, not the narrower assignee-bridge
 * DTO. `draftToReport` (also unmodified) stamps `kind` and the period
 * field(s) onto the final object.
 *
 * `summaryNarrative` is the one field this function actually AUTHORS --
 * `aggregateReportsIntoDraft` never touches it (it stays `''` on every
 * `blankDraft()`/`blankDailyDraft()`). A short, factual, non-editorial
 * sentence describing what was aggregated (source count, "this week"/"this
 * day") is not fabricated content -- it's a caption for the composition
 * itself -- so the deck's summary/glance slide never renders a silently
 * blank paragraph for a report nobody actually wrote prose for.
 */
export function buildSyntheticReport(input: SyntheticReportInput): AnyReport {
  const draft: Draft = input.kind === 'daily' ? blankDailyDraft() : blankDraft();
  draft.weekStart = input.weekStart ?? '';
  draft.weekEnd = input.weekEnd ?? '';
  draft.date = input.date ?? '';
  draft.preparedFor = input.preparedFor;
  draft.preparedBy = input.preparedBy;

  const { draft: aggregated } = aggregateReportsIntoDraft(input.sources, draft);
  aggregated.tasks = [...aggregated.tasks, ...input.bridgeOnlyTasks];

  const sourceCount = input.sources.length;
  const periodWord = input.kind === 'daily' ? 'this day' : 'this week';
  aggregated.summaryNarrative =
    sourceCount > 0
      ? `Consolidated from ${sourceCount} report${sourceCount === 1 ? '' : 's'} covering ${periodWord}.`
      : `No reports were found for ${periodWord}.`;

  return draftToReport(aggregated, SYNTHETIC_REPORT_ID, 'Draft', input.now);
}
