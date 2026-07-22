// Phase 6b: Zod schemas for the CSV importer's row shapes (lib/import.ts).
// One schema per `row_type` (report/task/risk/priority), validating the
// long-format row contract defined by `IMPORT_COLUMNS`
// (lib/csv-templates.ts) -- reuses the existing report-domain enums/date
// patterns (ReportStatusSchema/TaskStatusSchema/RiskSeveritySchema,
// isoDate/isoDateOrEmpty) so the importer's validation can never drift from
// what a hand-authored report already accepts.
//
// Deliberately validated as SEPARATE per-row-type schemas, not one
// discriminated union: every row in the source file carries every
// `IMPORT_COLUMNS` column (blank string for whatever doesn't apply to its
// `row_type`, mirroring `ImportRow`'s `blankRow()` scaffold) -- a
// discriminated union would force every irrelevant column into every
// branch's shape for no benefit, since `lib/import.ts` already knows which
// schema to apply from the row's own `row_type` cell before validating.

import { z } from 'zod';
import { isoDateOrEmpty, ReportStatusSchema, RiskSeveritySchema, TaskStatusSchema } from './report';

/** `kind` column on a `row_type='report'` row -- always required (decides which period columns apply). */
export const ImportKindSchema = z.enum(['weekly', 'daily']);
/** `kind` column on an item row (`task`/`risk`/`priority`) -- blank means "inherit the parent report row's kind" (checked in lib/import.ts, which is the only place both rows are in scope at once). */
const importItemKind = z.union([ImportKindSchema, z.literal('')]);

export const ImportRowTypeSchema = z.enum(['report', 'task', 'risk', 'priority']);

/** `calls`/`emails`/`escalations`: a non-negative integer string, or blank (treated as 0 by lib/import.ts). */
const countCell = z.union([z.string().regex(/^\d+$/, 'Expected a whole number.'), z.literal('')]);

/**
 * `row_type='report'` -- one per report. Period columns are validated here
 * only as "ISO or blank"; WHICH pair must actually be filled (matching
 * `kind`, mirroring the `reports_period_by_kind` SQL CHECK) is a structural
 * check in lib/import.ts, not expressible per-column in isolation.
 */
export const ImportReportRowSchema = z.object({
  kind: ImportKindSchema,
  report_key: z.string().min(1, 'report_key is required.'),
  row_type: z.literal('report'),
  week_start: isoDateOrEmpty,
  week_end: isoDateOrEmpty,
  date: isoDateOrEmpty,
  status: ReportStatusSchema,
  prepared_for: z.string(),
  prepared_by: z.string(),
  summary: z.string(),
  win_stat: z.string(),
  win_label: z.string(),
  win_narrative: z.string(),
  calls: countCell,
  emails: countCell,
  escalations: countCell,
  touchpoints_note: z.string(),
});

/** `row_type='task'` -- `item` carries the task text, `item_status` is `Complete|In Progress|Blocked`. `completed_at` (ISO or blank) is optional -- see lib/csv-templates.ts's `taskRow` doc comment for why a blank value on a Complete task is fine (the app's own auto-stamp/Schedule-view week-inference fallback still applies). */
export const ImportTaskRowSchema = z.object({
  kind: importItemKind,
  report_key: z.string().min(1, 'report_key is required.'),
  row_type: z.literal('task'),
  client: z.string().min(1, 'client is required.'),
  item: z.string().min(1, 'item (task) is required.'),
  item_status: TaskStatusSchema,
  deadline: isoDateOrEmpty,
  completed_at: isoDateOrEmpty,
});

/** `row_type='risk'` -- `item` carries the risk description, `severity` is `Blocked|At Risk`. */
export const ImportRiskRowSchema = z.object({
  kind: importItemKind,
  report_key: z.string().min(1, 'report_key is required.'),
  row_type: z.literal('risk'),
  client: z.string().min(1, 'client is required.'),
  item: z.string().min(1, 'item (risk description) is required.'),
  severity: RiskSeveritySchema,
  next_step: z.string(),
});

/** `row_type='priority'` -- `item` carries the priority text. */
export const ImportPriorityRowSchema = z.object({
  kind: importItemKind,
  report_key: z.string().min(1, 'report_key is required.'),
  row_type: z.literal('priority'),
  item: z.string().min(1, 'item (priority text) is required.'),
});
