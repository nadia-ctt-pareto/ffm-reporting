// Phase 6a: Zod schemas for the report domain. `lib/types.ts` becomes a pure
// facade over `z.infer<...>` of the schemas below -- see that file's header
// comment. These mirror the pre-Phase-6a hand-written `lib/types.ts` shapes
// PLUS the new optional `projectId` (added to TaskSchema/RiskSchema/
// ReportCoreSchema below). The facade rewrite itself was proven green by
// first authoring these WITHOUT `projectId` at all (byte-for-byte matching
// every pre-existing field), then adding `projectId` as a strictly-additive
// second pass -- safe because `.nullish()` makes the key optional, so it
// cannot change any pre-existing field's inferred type.
//
// z.infer of a regex'd string is still just `string`, and `.nullish()`
// infers `T | null | undefined` with an OPTIONAL key -- so every inferred
// type here is structurally identical to the interfaces it replaces. That
// structural-identity property is what keeps the lib/types.ts facade
// rewrite a no-op for every existing call site.

import { z } from 'zod';

/**
 * yyyy-mm-dd. Every date in this codebase is an ISO string compared with
 * `localeCompare` -- see CLAUDE.md "Conventions". Phase 7a: the regex alone
 * accepts calendrically-impossible strings like `2026-99-99` or `2026-02-29`
 * (2026 isn't a leap year) -- the `.refine()` below closes that by parsing
 * y/m/d, building a UTC date from them, and requiring the round-trip
 * (`getUTCFullYear`/`getUTCMonth`/`getUTCDate` match what was parsed) --
 * `Date.UTC` silently normalizes an out-of-range day/month (e.g. Feb 29 on a
 * non-leap year rolls into March 1) rather than throwing, so only the
 * round-trip check actually catches it. Landing this in the schema means
 * every consumer gets it at once: the CSV importer (lib/import.ts, already
 * built on this schema), Phase 7's route handlers, and Phase 8's MCP tools --
 * one definition, all edges. Cannot brick already-stored data: the UI
 * deliberately never validates the stored payload (see the 6a-era decision
 * preserved throughout this codebase), so a bad legacy date only ever
 * surfaces where it should -- as a per-record issue at CSV-import time, at
 * Supabase-import time, or as a 400 from a future route handler, never as a
 * crash reading `localStorage`. Wizard/report-screen dates come from
 * `<input type="date">` (always valid or `''`), so no legitimate UI flow
 * regresses.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a valid calendar date');
/** Task.deadline: '' = unset (maps to SQL NULL, see supabase/migrations/20260717000001_initial_schema.sql `tasks.deadline`). */
export const isoDateOrEmpty = z.union([isoDate, z.literal('')]);

/** Mirrors `reports.status` CHECK (supabase/migrations/20260717000001_initial_schema.sql). */
export const ReportStatusSchema = z.enum(['Draft', 'Final', 'Sent']);
/** Mirrors `tasks.status` CHECK. */
export const TaskStatusSchema = z.enum(['Complete', 'In Progress', 'Blocked']);
/** Mirrors `risks.severity` CHECK. */
export const RiskSeveritySchema = z.enum(['Blocked', 'At Risk']);

// =============================================================================
// READ (row) schemas -- PERMISSIVE BY DESIGN, see BLOCKER A (post-review
// round 2) below. `AnyReportSchema`/`ReportCoreSchema` and every nested
// Task/Risk/Priority/Win/Touchpoints schema in THIS section describe what a
// TRUSTED source (Postgres, or the localStorage repository) can hand back --
// `lib/server/reports-service.ts`'s `listReports`/`getReport` parse every
// row against these. They intentionally impose NO length/count ceiling
// beyond what a real SQL CHECK constraint enforces (enums, `isoDate`'s
// calendar-validity `.refine()`) -- see the `*InputSchema` section further
// down for the bounded, write-boundary variants.
// =============================================================================

export const TaskSchema = z.object({
  id: z.string().min(1),
  client: z.string(),
  /** Phase 6a: optional FK to a Project, stamped by exact-name backfill (lib/projects.ts). Pure metadata -- `client` stays the display/dedupe string everywhere. */
  projectId: z.string().nullish(),
  task: z.string(),
  status: TaskStatusSchema,
  deadline: isoDateOrEmpty,
  /**
   * Task completion date: the SAME `isoDateOrEmpty` convention `deadline`
   * uses ('' = unset, maps to SQL NULL -- see
   * supabase/migrations/20260725000014_task_completed_at.sql's nullable
   * `tasks.completed_at date`), wrapped in `.nullish()` (optional key,
   * `null` also accepted) purely so an ALREADY-EXISTING task object --
   * anything sitting in a browser's `ff.reports.v2` before this field
   * existed, or any object literal in code that never mentions this key --
   * stays a valid `Task` with zero migration/backfill. Every write path
   * this app controls (lib/server/db-mapping.ts's `mapTaskRow`,
   * lib/import.ts's `buildTask`, lib/server/mcp-tools.ts's `create_report`)
   * always normalizes an absent/NULL value to `''`, matching `deadline`
   * exactly, so application code can treat `Task.completedAt` as a plain
   * string in practice -- the `.nullish()` here exists only to keep OLD
   * data valid, not because new code is expected to produce `null`/
   * `undefined`.
   *
   * Auto-stamped (never invented/guessed): the moment a task's status
   * becomes `'Complete'` through ANY write path, `lib/report-utils.ts`'s
   * `taskCompletionStamp` stamps today's date here if nothing is recorded
   * yet; moving a task OFF `'Complete'` clears it back to `''`. Editable
   * afterward (a PM can correct it -- reports are often written up days
   * later) -- see `components/tasks/TaskDialog.tsx`'s "Completed On" field.
   * Powers `lib/task-schedule.ts`'s day-level (not just week-level)
   * on-time/late classification when present.
   */
  completedAt: isoDateOrEmpty.nullish(),
  /**
   * WP2: optional FK to a `TeamMember` (supabase/migrations/
   * 20260726000017_task_assignee.sql's `tasks.assignee_id`), the SAME
   * `.nullish()` optional-key treatment `projectId` gets immediately above
   * (uncapped on THIS read schema -- see BLOCKER A's doc comment further
   * down for why a length cap belongs only on `TaskInputSchema`'s write-
   * boundary twin, never here) -- pure task-ownership metadata, never a
   * permission grant by itself (see that migration's header comment and
   * `lib/schema/team.ts`'s identical disclaimer for `TeamMember.role`).
   * `undefined`/`null`/absent all mean "unassigned". An MCP caller must
   * never invent or guess an id here -- see `skills/weekly-reports/
   * SKILL.md`'s Task-shape guidance.
   */
  assigneeId: z.string().nullish(),
  /**
   * WP2: the day THIS task ROW was first authored (supabase/migrations/
   * 20260726000017_task_assignee.sql's `tasks.created_at`) -- the SAME
   * `isoDateOrEmpty`-then-`.nullish()` convention `completedAt` uses
   * immediately above (an already-existing task object with no key here
   * stays a valid `Task`, zero migration/backfill needed). Stamped ONLY at
   * genuine creation (wizard "Add Task", the `/tasks` Add Task dialog, a
   * CSV import row, an MCP `create_report` call) -- deliberately NEVER
   * re-stamped or preserved on a carry-forward/import-selected/aggregated
   * task copy (see `lib/aggregate.ts`'s `carryForwardUnfinishedTasks`/
   * `aggregateReportsIntoDraft` and `components/wizard/useWizard.ts`'s
   * `importSelectedTasks` for the design reasoning: those copies already
   * mint a fresh `id` and drop `completedAt`, i.e. they are already treated
   * as new, independent task records, not literal continuations -- but
   * stamping "today" on a task that is clearly OLD, carried-forward work
   * would misrepresent it as freshly authored, which is worse than the
   * honest "not recorded" this leaves it as).
   */
  createdAt: isoDateOrEmpty.nullish(),
});

export const RiskSchema = z.object({
  id: z.string().min(1),
  client: z.string(),
  /** Phase 6a: see TaskSchema.projectId. */
  projectId: z.string().nullish(),
  severity: RiskSeveritySchema,
  description: z.string(),
  nextStep: z.string(),
});

export const PrioritySchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});

export const WinSchema = z.object({
  stat: z.string(),
  label: z.string(),
  narrative: z.string(),
});

export const TouchpointsSchema = z.object({
  calls: z.number().int().nonnegative(),
  emails: z.number().int().nonnegative(),
  escalations: z.number().int().nonnegative(),
  narrative: z.string(),
});

/**
 * Every field a weekly report and a daily report share -- mirrors
 * `ReportCore` in lib/types.ts. `createdAt`/`updatedAt` are deliberately
 * plain `z.string()`, not `isoDate`: `ReportScreen.emptyReportFallback`
 * legitimately uses `''`, and runtime validation only ever runs at the
 * import boundary (Phase 7), never on this fallback -- so nothing gains
 * from rejecting it here.
 *
 * BLOCKER A (post-review round 2): a prior pass (SHOULD-FIX 8) added
 * `.max()` length/count caps directly on THIS schema, over Postgres columns
 * that have no matching constraint at the time -- every `reports`/`tasks`/
 * `risks`/`priorities` text column is unbounded `text`. Because
 * `lib/server/reports-service.ts`'s `listReports`/`getReport` parse EVERY
 * row against this schema (via `AnyReportSchema`, which extends this one)
 * and `mapRow` THROWS on a failed parse, and `reports_select` is
 * `using (true)` (every authenticated user can read every report), that
 * turned a legitimate write -- any owner PATCHing an over-cap value into
 * their OWN report through the public anon key, which RLS permits -- into a
 * 500 for `GET /api/reports` for every user in the org, with no in-app
 * recovery (the poisoned row can't be listed, opened, or patched back
 * through the API). Confirmed exploited end-to-end.
 *
 * The fix is NOT "raise the caps" -- it's that a READ schema must stay
 * satisfiable by construction: validation that can reject data the
 * database legitimately contains is an availability bug, not a safety
 * feature. So the caps moved OFF this schema entirely, onto the
 * `*InputSchema` variants below (the actual write boundary, which is where
 * SHOULD-FIX 8 meant them to land), a matching SQL CHECK constraint was
 * added per-column (`supabase/migrations/20260720000006_post_review_hardening_round2.sql`)
 * so a direct-PostgREST write is ALSO capped at the database layer (closing
 * the gap `*InputSchema` alone can't -- it only guards this app's own
 * `POST`/`PATCH` handlers, not a client hitting PostgREST directly with
 * the anon key), and `listReports` now skip-and-logs a row that still
 * somehow fails this permissive parse instead of throwing for the whole
 * batch (see that function) -- three independent layers, not one, because
 * any single one of them could in principle drift from the others in the
 * future and this schema staying permissive is what keeps that drift from
 * ever becoming an outage again.
 */
export const ReportCoreSchema = z.object({
  id: z.string().min(1),
  status: ReportStatusSchema,
  preparedFor: z.string(),
  preparedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  summaryNarrative: z.string(),
  tasks: z.array(TaskSchema),
  risks: z.array(RiskSchema),
  win: WinSchema,
  touchpoints: TouchpointsSchema,
  priorities: z.array(PrioritySchema),
  /** Phase 6a: the Project this report was imported into (undefined/null for house-authored, multi-client reports -- the "house" bucket). Pure metadata: drives consolidation grouping, the daily-uniqueness bucket (see sameProjectBucket in lib/report-utils.ts), and the SQL FK. */
  projectId: z.string().nullish(),
  /** Phase 7a: mirrors `reports.owner_id` (supabase/migrations/20260719000004_auth_ownership.sql) -- the auth.users id of the report's owner, NULL/undefined for system/unclaimed rows. Additive only; no UI reads or writes this in Phase 7a (7b's reports-service stamps it server-side, never trusted from the client). SHOULD-FIX I (post-review round 2): deliberately still selected/broadcast to every authenticated user (`REPORT_COLUMNS`, lib/server/reports-service.ts) even though nothing under components/ reads it today -- this is an internal-team app (a handful of PMs at one agency), an opaque `auth.users` UUID is low-sensitivity among coworkers, and a future owner-aware affordance (e.g. the Share dialog showing "shared by <owner>", or an admin-only "reassign owner" control) would want it already flowing through the same read path rather than needing a second, narrower one added later. Contrast `shareToken` (BLOCKER 1, same migration) -- that column grants ANONYMOUS access the instant it's known, an entirely different risk class, which is why it got a dedicated owner-gated RPC instead of this treatment. */
  ownerId: z.string().nullish(),
  /** Phase 7a: mirrors `reports.share_token` (see the same migration) -- an opt-in public share token, NULL by default (sharing is per-report opt-in). Server-generated only, never client-supplied. Additive only; no UI reads or writes this in Phase 7a (7b's reports-service stamps it server-side, never trusted from the client). */
  shareToken: z.string().nullish(),
});

export const WeeklyReportSchema = ReportCoreSchema.extend({
  kind: z.literal('weekly'),
  weekStart: isoDate,
  weekEnd: isoDate,
});

export const DailyReportSchema = ReportCoreSchema.extend({
  kind: z.literal('daily'),
  date: isoDate,
});

export const AnyReportSchema = z.discriminatedUnion('kind', [WeeklyReportSchema, DailyReportSchema]);

// =============================================================================
// INPUT (write-boundary) schemas -- BOUNDED, see BLOCKER A above.
// `*InputSchema` is what every route handler validates a REQUEST BODY
// against (never `ReportCoreSchema`/`AnyReportSchema` -- see the "Post-review
// addition (Phase 7a)" comment further down), and what `lib/import.ts`'s
// belt-and-braces check runs assembled CSV-derived reports through: both are
// genuinely untrusted-input boundaries, unlike a value already sitting in
// Postgres.
// =============================================================================

/**
 * Post-review hardening (SHOULD-FIX 8): unbounded strings/arrays at the
 * write boundary -- `request.json()` buffers the WHOLE body before Zod ever
 * gets a chance to reject it (Next 15 Route Handlers on the Node runtime
 * have no default body-size limit), and a pathological payload could hold
 * `replace_reports`' row locks for an unreasonably long transaction. These
 * bounds don't change any INFERRED TS type (`.max()` on a `string`/array
 * stays `string`/`T[]`) -- so per CLAUDE.md's migrations-discipline rule
 * ("changes to lib/schema/... or the inferred lib/types.ts domain SHAPES"),
 * no migration/docs delta was needed for THIS file alone; the round-2 fix
 * that MOVED these here (rather than leaving them on the read schema too)
 * does add one, because it also adds matching SQL CHECK constraints -- see
 * `ReportCoreSchema`'s doc comment above. Every cap below is generous
 * relative to any real weekly/daily report (a handful of tasks/risks/
 * priorities, prose paragraphs) -- these exist to reject a pathological
 * payload, not to constrain legitimate use.
 */
const MAX_ID_LEN = 200;
const MAX_SHORT_TEXT = 500;
const MAX_LONG_TEXT = 20_000;
const MAX_CHILD_ROWS = 500;

export const TaskInputSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LEN),
  client: z.string().max(MAX_SHORT_TEXT),
  projectId: z.string().max(MAX_ID_LEN).nullish(),
  task: z.string().max(MAX_LONG_TEXT),
  status: TaskStatusSchema,
  deadline: isoDateOrEmpty,
  /** See TaskSchema.completedAt above -- same bounded-write-boundary treatment `deadline` gets (no separate `.max()` needed; `isoDateOrEmpty` is already a fixed-shape regex, not free text). */
  completedAt: isoDateOrEmpty.nullish(),
  /** See TaskSchema.assigneeId above -- `.max(MAX_ID_LEN)` here mirrors `projectId`'s own write-boundary bound immediately above (an FK-style id string, not free text). */
  assigneeId: z.string().max(MAX_ID_LEN).nullish(),
  /** See TaskSchema.createdAt above -- same bounded-write-boundary treatment `deadline`/`completedAt` get (no separate `.max()` needed; `isoDateOrEmpty` is already a fixed-shape regex). */
  createdAt: isoDateOrEmpty.nullish(),
});

export const RiskInputSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LEN),
  client: z.string().max(MAX_SHORT_TEXT),
  projectId: z.string().max(MAX_ID_LEN).nullish(),
  severity: RiskSeveritySchema,
  description: z.string().max(MAX_LONG_TEXT),
  nextStep: z.string().max(MAX_LONG_TEXT),
});

export const PriorityInputSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LEN),
  text: z.string().max(MAX_LONG_TEXT),
});

export const WinInputSchema = z.object({
  stat: z.string().max(MAX_SHORT_TEXT),
  label: z.string().max(MAX_SHORT_TEXT),
  narrative: z.string().max(MAX_LONG_TEXT),
});

export const TouchpointsInputSchema = z.object({
  calls: z.number().int().nonnegative().max(100_000),
  emails: z.number().int().nonnegative().max(100_000),
  escalations: z.number().int().nonnegative().max(100_000),
  narrative: z.string().max(MAX_LONG_TEXT),
});

/**
 * Post-review addition (Phase 7a): the READ schemas above are the ROW
 * shape (what comes back FROM a trusted source -- Postgres, or the
 * localStorage repository) -- `ownerId`/`shareToken` belong there because
 * `ReportCore`/`AnyReport` (lib/types.ts) need to type them. They are
 * DELIBERATELY WRONG for validating an incoming REQUEST BODY: Zod strips
 * only *unknown* keys, and `ownerId`/`shareToken` are now known keys on
 * those schemas, so `AnyReportSchema.parse(untrustedBody)` would pass a
 * client-supplied `ownerId`/`shareToken` straight through unchallenged --
 * exactly the "never trusted from the client" property their own doc
 * comments assert, silently inverted by being reachable through the shared
 * schema. RLS still blocks a foreign `ownerId` at the database layer
 * (`reports_insert`/`reports_update`'s `with check`), but `shareToken` has
 * no such backstop by design (it's meant to be settable at all, just never
 * by the client directly -- see `enable_report_share`/`revoke_report_share`,
 * supabase/migrations/20260719000004_auth_ownership.sql).
 *
 * Every route handler (and anything else parsing a request body) MUST use
 * THIS schema (or `AnyReportInputSchema` below), never `ReportCoreSchema`/
 * `AnyReportSchema` directly, for that purpose -- and, per BLOCKER A above,
 * this is also the only place the `.max()` bounds apply at all.
 */
export const ReportCoreInputSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LEN),
  status: ReportStatusSchema,
  preparedFor: z.string().max(MAX_SHORT_TEXT),
  preparedBy: z.string().max(MAX_SHORT_TEXT),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  summaryNarrative: z.string().max(MAX_LONG_TEXT),
  tasks: z.array(TaskInputSchema).max(MAX_CHILD_ROWS),
  risks: z.array(RiskInputSchema).max(MAX_CHILD_ROWS),
  win: WinInputSchema,
  touchpoints: TouchpointsInputSchema,
  priorities: z.array(PriorityInputSchema).max(MAX_CHILD_ROWS),
  projectId: z.string().nullish(),
});

export const WeeklyReportInputSchema = ReportCoreInputSchema.extend({
  kind: z.literal('weekly'),
  weekStart: isoDate,
  weekEnd: isoDate,
});

export const DailyReportInputSchema = ReportCoreInputSchema.extend({
  kind: z.literal('daily'),
  date: isoDate,
});

export const AnyReportInputSchema = z.discriminatedUnion('kind', [WeeklyReportInputSchema, DailyReportInputSchema]);
