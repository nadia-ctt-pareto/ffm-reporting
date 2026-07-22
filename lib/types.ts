// Domain types for the Weekly Reports Dashboard.
// Mirrors the shapes produced by design-source/original-dashboard.dc.html's
// ffSeedReports() / ffBlankDraft() (script block, lines 415-506).
//
// Phase 4 (daily reports): the domain model became a discriminated union --
// `WeeklyReport` (one per week) and `DailyReport` (one per day, covering all
// clients) share every field except their period ("weekStart"/"weekEnd" vs.
// "date"). `Report` stays an alias for `WeeklyReport` so every Phase 1-3
// call site (dashboard, weekly wizard, CSV, report/deck/present, task &
// calendar views) keeps compiling unchanged -- `ReportsRepository.getAll()`
// still only ever returns weeklies (see lib/data/), which is what makes
// that alias sound everywhere it's used.
//
// Phase 6a: this file is now a pure FACADE over `lib/schema/` -- every
// exported type below is `z.infer<typeof XSchema>`, not a hand-written
// interface. The Zod schemas are the single source of truth; this file
// exists so ~60 import sites across the codebase keep importing types from
// `lib/types.ts` unchanged. Because a regex'd `z.string()` still infers as
// plain `string` and `.nullish()` infers an optional `T | null | undefined`
// key, every inferred type here is structurally identical to the interfaces
// it replaces -- see lib/schema/report.ts's header comment.

import type { z } from 'zod';
import type {
  AnyReportSchema,
  DailyReportSchema,
  PrioritySchema,
  ProjectSchema,
  ReportCoreSchema,
  RiskSchema,
  RiskSeveritySchema,
  TaskSchema,
  TaskStatusSchema,
  TeamMemberRoleSchema,
  TeamMemberSchema,
  TouchpointsSchema,
  WeeklyReportSchema,
  WinSchema,
  ReportStatusSchema,
} from './schema';

export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

/**
 * Badge visual tone. NOTE: 'green' is intentionally included here even though
 * the Badge component has no distinct rendering for it. The prototype's
 * ffStatusTone() (design-source line 441) returns 'green' for Final-status
 * reports, but ffBadgeStyle() (line 430-440) has no 'green' entry in its tone
 * map -- so "Final" badges silently fall back to the 'neutral' style. This is
 * a faithful port of that prototype quirk; do not "fix" it silently. UI-only
 * -- deliberately NOT part of lib/schema (there is no SQL column to mirror).
 */
export type BadgeTone = 'positive' | 'negative' | 'warning' | 'sage' | 'dark' | 'neutral' | 'green';

/** UI-only sort key (dashboard). Not part of lib/schema -- no SQL column to mirror. */
export type SortKey = 'week_desc' | 'week_asc' | 'status' | 'blockers_desc';

/** Phase 4: which shape of report a given row/draft is. UI-only. */
export type ReportKind = 'weekly' | 'daily';

export type Task = z.infer<typeof TaskSchema>;

export type Risk = z.infer<typeof RiskSchema>;

export type Priority = z.infer<typeof PrioritySchema>;

export type Win = z.infer<typeof WinSchema>;

export type Touchpoints = z.infer<typeof TouchpointsSchema>;

/**
 * Every field a weekly report and a daily report share. Exported (not just
 * a private helper interface) because `ReportsRepository.update()`'s patch
 * type is `Partial<ReportCore>` -- see lib/data/reports-repository.ts.
 */
export type ReportCore = z.infer<typeof ReportCoreSchema>;

export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;

/** One per calendar day, covering all clients (not per-client). */
export type DailyReport = z.infer<typeof DailyReportSchema>;

export type AnyReport = z.infer<typeof AnyReportSchema>;

/** Phase 6a: `Project { id, name }` -- matches the SQL `projects` table exactly (renamed from `clients`, see supabase/migrations/20260718000003_projects.sql). Ids are the slugs seeded in the baseline migration; see lib/seed.ts's seedProjects(). */
export type Project = z.infer<typeof ProjectSchema>;

/** WP1: the role-ladder tier shown on a directory row -- a LABEL only, see lib/schema/team.ts's header comment (this is NOT the same thing as lib/roles.ts's `Role`, which is the JWT app_metadata.role authority). */
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

/** WP1: `TeamMember { id, name, role, email?, userId? }` -- matches the SQL `team_members` table exactly (supabase/migrations/20260726000016_team_members.sql). See lib/schema/team.ts's header comment for why `role` here carries no permission meaning. */
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/**
 * Alias retained so every Phase 1-3 call site (dashboard, weekly wizard,
 * CSV, report screen/deck/present route, task/calendar views) keeps
 * compiling with near-zero churn post-Phase-4. Sound because
 * `ReportsRepository.getAll()` is contractually weeklies-only (see
 * lib/data/reports-repository.ts) -- everywhere `Report` is used, the value
 * really is a `WeeklyReport`.
 */
export type Report = WeeklyReport;

/**
 * Loose patch shape accepted by `ReportScreen`'s `onUpdateFields` (shared by
 * both the weekly and daily report screens): any `ReportCore` field, plus
 * optionally the period fields of *either* kind. The weekly report route
 * only ever sends `weekStart`/`weekEnd`; the daily route only ever sends
 * `date` -- this type just needs to be wide enough for both callers to
 * accept it, and structurally narrow enough that `Partial<WeeklyReport>` /
 * `Partial<DailyReport>` (what `useReports`/`useDailyReports` actually
 * declare) each accept a `ReportFieldPatch` argument.
 */
export type ReportFieldPatch = Partial<ReportCore> & { weekStart?: string; weekEnd?: string; date?: string };

/**
 * WP3 (the access flip): one of the CALLER's own assigned tasks
 * (`public.list_assigned_tasks()`, supabase/migrations/20260726000018_scoped_access.sql),
 * joined with BOUNDED parent-report context ONLY -- never sibling tasks,
 * risks, priorities, or the report's own narrative fields (that omission is
 * the entire trust boundary that makes "an assignee can see their own task"
 * safe on a report they otherwise have no access to). Hand-written (not
 * schema-derived, unlike `Task`/`AnyReport`) because it's a pure READ
 * projection assembled server-side -- nothing under `lib/schema/` stores
 * this shape, it's the SQL RPC's own bespoke join result.
 */
export interface AssignedTask extends Task {
  reportId: string;
  reportKind: ReportKind;
  /** Present (weekly) / absent (daily) -- mirrors `AnyReport`'s own kind-conditional period fields. */
  weekStart?: string;
  weekEnd?: string;
  /** Present (daily) / absent (weekly). */
  date?: string;
  preparedFor: string;
  /** The report owner's team-directory name, when linkable (WP1's `team_members.user_id` self-link) -- `undefined` if the owner has no linked directory row. */
  ownerName?: string;
}

/**
 * WP3: the narrow, allowed patch shape for the assignee-writable RPC path
 * (`public.update_assigned_task`) -- status/deadline/completedAt ONLY,
 * mirroring that SQL function's own narrow column list exactly. Deliberately
 * NOT `Partial<Task>` (too wide): an assignee must never be able to change
 * `task`, `client`, `assigneeId`, or `projectId` through this path -- those
 * are identity/dedupe fields other people's report chains depend on (see
 * CLAUDE.md's "Migrations discipline" tripwire on this migration).
 */
export type AssignedTaskPatch = Pick<Partial<Task>, 'status' | 'deadline' | 'completedAt'>;

/**
 * Shape of an in-progress (not-yet-saved) report, as produced by
 * blankDraft() / blankDailyDraft() / resumeDraft() in the prototype (and its
 * Phase 4 daily-report sibling). `id` is null until the first save.
 * `weekStart`/`weekEnd`/`date` are ALWAYS present regardless of `kind` (the
 * unused pair is just `''`) -- this keeps every wizard step's props
 * unconditional; only `StepBasics` branches on `kind`. Consumed by the
 * wizard (Pass 2 / Phase 4). Hand-written, not schema-derived -- an
 * in-progress draft is deliberately looser than a persisted `AnyReport`
 * (e.g. both period pairs coexist, `id` may be null).
 */
export interface Draft {
  id: string | null;
  kind: ReportKind;
  weekStart: string;
  weekEnd: string;
  date: string;
  preparedFor: string;
  preparedBy: string;
  summaryNarrative: string;
  status: ReportStatus;
  tasks: Task[];
  touchpoints: Touchpoints;
  win: Win;
  risks: Risk[];
  priorities: Priority[];
  createdAt?: string;
  updatedAt?: string;
  /** Phase 6a: see ReportCoreSchema.projectId (lib/schema/report.ts). `reportToDraft` already spreads it in at runtime; `draftToReport` must carry it explicitly (see components/wizard/useWizard.ts) or resuming an imported draft-status report through the wizard would silently strip its project. */
  projectId?: string | null;
}
