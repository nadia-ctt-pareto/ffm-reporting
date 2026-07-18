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

/** yyyy-mm-dd. Every date in this codebase is an ISO string compared with `localeCompare` -- see CLAUDE.md "Conventions". */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd');
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
