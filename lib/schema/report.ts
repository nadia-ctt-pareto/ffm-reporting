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

export const TaskSchema = z.object({
  id: z.string().min(1),
  client: z.string(),
  /** Phase 6a: optional FK to a Project, stamped by exact-name backfill (lib/projects.ts). Pure metadata -- `client` stays the display/dedupe string everywhere. */
  projectId: z.string().nullish(),
  task: z.string(),
  status: TaskStatusSchema,
  deadline: isoDateOrEmpty,
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
  /** Phase 7a: mirrors `reports.owner_id` (supabase/migrations/20260719000004_auth_ownership.sql) -- the auth.users id of the report's owner, NULL/undefined for system/unclaimed rows. Additive only; no UI reads or writes this in Phase 7a (7b's reports-service stamps it server-side, never trusted from the client). */
  ownerId: z.string().nullish(),
  /** Phase 7a: mirrors `reports.share_token` (see the same migration) -- an opt-in public share token, NULL by default (sharing is per-report opt-in). Server-generated only, never client-supplied. Additive only; no UI reads or writes this in Phase 7a -- the Share dialog's Enable/Revoke UI and the token-aware present route are Phase 7b. */
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

/**
 * Post-review addition (Phase 7a): the *_Schema exports above are the ROW
 * shape (what comes back FROM a trusted source -- Postgres, or the
 * localStorage repository) -- `ownerId`/`shareToken` belong there because
 * `ReportCore`/`AnyReport` (lib/types.ts) need to type them. They are
 * DELIBERATELY WRONG for validating an incoming REQUEST BODY: Zod strips
 * only *unknown* keys, and `ownerId`/`shareToken` are now known keys on
 * these schemas, so `AnyReportSchema.parse(untrustedBody)` would pass a
 * client-supplied `ownerId`/`shareToken` straight through unchallenged --
 * exactly the "never trusted from the client" property their own doc
 * comments assert, silently inverted by being reachable through the shared
 * schema. RLS still blocks a foreign `ownerId` at the database layer
 * (`reports_insert`/`reports_update`'s `with check`), but `shareToken` has
 * no such backstop by design (it's meant to be settable at all, just never
 * by the client directly -- see `enable_report_share`/`revoke_report_share`,
 * supabase/migrations/20260719000004_auth_ownership.sql).
 *
 * Phase 7b's route handlers (and anything else parsing a request body) MUST
 * use the `*InputSchema` variants below, never `ReportCoreSchema`/
 * `AnyReportSchema` directly, for that purpose.
 */
export const ReportCoreInputSchema = ReportCoreSchema.omit({ ownerId: true, shareToken: true });

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
