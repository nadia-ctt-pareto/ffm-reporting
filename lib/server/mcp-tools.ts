// Phase 8a: the 8-tool MCP surface (`app/api/[transport]/route.ts` wires
// `registerMcpTools` into `createMcpHandler`'s `initializeServer` callback,
// which runs fresh once PER REQUEST in stateless mode -- see that file's
// comment). Every tool body is a THIN composition over
// `lib/server/reports-service.ts` (untouched by this phase, per the plan's
// scope) -- this file owns input validation (Zod, always the bounded
// `*InputSchema` variants, never a permissive read schema), duplicate/
// existence guards, response shaping, and the `ServiceError` -> tool-error
// mapping. No tool constructs its own Supabase client -- every one reads
// the bridged, user-scoped client off `extra.authInfo.extra.db`
// (lib/server/mcp-auth.ts's `verifyMcpAuth`) via `requireAuth` below.
//
// Tool-name contract: `MCP_TOOL_NAMES` is the single source of truth for
// which 8 names exist -- `registerMcpTools` is written so registration is
// DRIVEN BY this array (see the `TOOL_DEFS` record + the loop at the bottom
// of this file), not just eyeballed against it, and asserts the two agree
// at the end of every single registration pass (cheap -- 8 strings -- and
// deliberately paranoid for a security-sensitive contract that runs on
// every request). `scripts/check-mcp-tool-contract.ts` separately diffs
// this array against `lib/prompts.ts`'s "Canonical MCP tool names" comment
// block (kept comment-only by design, see that file) -- see this file's
// own `MCP_TOOL_NAMES` doc comment for why that has to be a parsed diff
// rather than a shared import. `delete_report` deliberately does not
// exist anywhere in this file -- see skills/weekly-reports/SKILL.md's
// "Access model".

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { aggregateReportsIntoDraft } from '../aggregate';
import { addDaysISO, isoWeekday } from '../calendar';
import { nowDate, uid } from '../format';
import {
  blankDraft,
  draftToReport,
  onSchedule,
  openBlockers,
  reportPeriodEnd,
  reportPeriodLabel,
} from '../report-utils';
import { ReportPatchSchema } from '../schema/api';
import {
  AnyReportInputSchema,
  RiskSeveritySchema,
  ReportStatusSchema,
  TaskStatusSchema,
  TouchpointsInputSchema,
  WinInputSchema,
  isoDate,
  isoDateOrEmpty,
} from '../schema/report';
import type { AnyReport, Draft, ReportKind } from '../types';
import {
  ServiceError,
  curatedMessage,
  ensureProject,
  getReport,
  listProjects,
  listReports,
  logServiceError,
  updateReport,
  upsertReports,
} from './reports-service';

// =============================================================================
// The locked tool surface -- see this file's header comment.
// =============================================================================
export const MCP_TOOL_NAMES = [
  'list_reports',
  'get_report',
  'list_projects',
  'get_week_rollup',
  'create_report',
  'update_report',
  'create_project',
  'create_weekly_from_dailies',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

// =============================================================================
// Small shared helpers
// =============================================================================

/** Exact-after-trim+casefold -- the same normalization idiom used throughout this codebase (CSV import's project-name matching, consolidation's client-name matching) for "is this the same string a human typed, modulo whitespace/case." */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

interface McpToolAuth {
  userId: string;
  db: SupabaseClient;
}

/**
 * Reads the bridged `{ userId, db }` back out of `extra.authInfo.extra`
 * (stashed there by `lib/server/mcp-auth.ts`'s `verifyMcpAuth`). Always
 * present in practice -- `app/api/[transport]/route.ts` wraps every tool
 * call in `withMcpAuth({ required: true })`, so a request without a valid
 * bridge never reaches a tool handler at all -- but this stays a real,
 * checked failure path rather than a non-null assertion: a missing/
 * malformed bridge must NEVER fall through to an unscoped Supabase call, and
 * the cheapest way to guarantee that is to make "no bridge" a hard,
 * explicit tool error instead of a type-level promise.
 */
function requireAuth(extra: { authInfo?: AuthInfo }): McpToolAuth | null {
  const raw = extra.authInfo?.extra;
  if (!raw || typeof raw !== 'object') return null;
  const userId = (raw as Record<string, unknown>).userId;
  const db = (raw as Record<string, unknown>).db;
  if (typeof userId !== 'string' || !db) return null;
  return { userId, db: db as SupabaseClient };
}

const UNAUTHORIZED_RESULT: CallToolResult = {
  content: [{ type: 'text', text: 'You must connect with a valid MCP token to do that.' }],
  isError: true,
};

function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function toolSuccess(summary: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent };
}

/**
 * Every tool body runs through this: catches a thrown `ServiceError` from
 * `reports-service.ts`, curates its message (`curatedMessage` -- never a raw
 * Postgres error reaches an MCP client), and logs it server-side
 * (`logServiceError`, the same audit call every `app/api/**` route handler
 * makes) -- the tool-surface mirror of `route-helpers.ts`'s
 * `handleServiceError`. A genuinely unexpected (non-`ServiceError`) throw
 * maps to the same generic "something went wrong" text every other unhandled
 * error in this codebase uses, never the raw exception message.
 */
async function withServiceErrors(
  route: string,
  userId: string,
  reportId: string | undefined,
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) {
      logServiceError(err, { route, userId, reportId });
      return toolError(curatedMessage(err.code, err.message));
    }
    console.error(`[mcp-tools] ${route} unexpected error`, err);
    return toolError('Something went wrong on our end. Please try again.');
  }
}

/** `{start, end}` ISO bounds for a report's own period -- weekly uses weekStart/weekEnd, daily uses its single date for both. Local to this file (the plan's own instruction: "inline the two-kind overlap predicate, don't reuse reportsOverlappingRange, weeklies-only"). */
function reportPeriodBounds(report: AnyReport): { start: string; end: string } {
  return report.kind === 'weekly' ? { start: report.weekStart, end: report.weekEnd } : { start: report.date, end: report.date };
}

/** True when `report`'s own period overlaps the closed interval `[start, end]` (both ISO strings) -- ordinary interval overlap, compared via `localeCompare` per this codebase's "dates are ISO strings" rule. */
function overlapsRange(report: AnyReport, start: string, end: string): boolean {
  const bounds = reportPeriodBounds(report);
  return bounds.start.localeCompare(end) <= 0 && bounds.end.localeCompare(start) >= 0;
}

/** id/kind/period/status/counts/updatedAt -- the summary shape `list_reports`, `get_week_rollup`'s `sources`, `create_report`, and `update_report` all echo. Deliberately omits `shareToken` (never present on the mapped domain object to begin with, see db-mapping.ts) and the full tasks/risks/priorities arrays (see `get_report` for the full object). */
function summarizeReport(report: AnyReport) {
  const { onSched, total } = onSchedule(report);
  return {
    id: report.id,
    kind: report.kind,
    period: reportPeriodLabel(report),
    ...(report.kind === 'weekly' ? { weekStart: report.weekStart, weekEnd: report.weekEnd } : { date: report.date }),
    status: report.status,
    preparedFor: report.preparedFor,
    preparedBy: report.preparedBy,
    projectId: report.projectId ?? null,
    taskCount: total,
    riskCount: report.risks.length,
    onSchedule: onSched,
    openBlockers: openBlockers(report),
    updatedAt: report.updatedAt,
  };
}

// =============================================================================
// Shared child-row input shapes for create_report / create_weekly_from_dailies
// (create_weekly_from_dailies assembles its report from an aggregated Draft,
// never from these directly, but they document the same server-generated-id
// posture: no tool ever accepts an incoming task/risk/priority id).
// =============================================================================

const McpTaskInputSchema = z.object({
  client: z.string().min(1).max(500),
  project_id: z.string().max(200).nullish(),
  task: z.string().min(1).max(20_000),
  status: TaskStatusSchema.optional().default('In Progress'),
  deadline: isoDateOrEmpty.optional().default(''),
});

const McpRiskInputSchema = z.object({
  client: z.string().min(1).max(500),
  project_id: z.string().max(200).nullish(),
  severity: RiskSeveritySchema.optional().default('At Risk'),
  description: z.string().min(1).max(20_000),
  next_step: z.string().max(20_000).optional().default(''),
});

const McpPriorityInputSchema = z.object({
  text: z.string().min(1).max(20_000),
});

const MAX_CHILD_ROWS = 500;

// =============================================================================
// list_reports
// =============================================================================

const ListReportsInputSchema = z.object({
  kind: z.enum(['weekly', 'daily']).optional(),
  prepared_for: z.string().max(500).optional(),
  week_start_from: isoDate.optional(),
  week_start_to: isoDate.optional(),
  limit: z.number().int().positive().max(100).optional().default(20),
});

const listReportsTool: ToolCallback<typeof ListReportsInputSchema.shape> = async (
  { kind, prepared_for, week_start_from, week_start_to, limit },
  extra
) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/list_reports', auth.userId, undefined, async () => {
    const reports = await listReports(auth.db, kind as ReportKind | undefined);
    let filtered = reports;
    if (prepared_for) {
      const needle = normalize(prepared_for);
      filtered = filtered.filter((r) => normalize(r.preparedFor) === needle);
    }
    if (week_start_from || week_start_to) {
      filtered = filtered.filter((r) => {
        const start = reportPeriodBounds(r).start;
        if (week_start_from && start.localeCompare(week_start_from) < 0) return false;
        if (week_start_to && start.localeCompare(week_start_to) > 0) return false;
        return true;
      });
    }
    const sorted = [...filtered].sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)));
    const limited = sorted.slice(0, limit);
    const reportsOut = limited.map(summarizeReport);
    return toolSuccess(`Found ${filtered.length} report(s), showing ${reportsOut.length}.`, { reports: reportsOut, total: filtered.length });
  });
};

// =============================================================================
// get_report
// =============================================================================

const GetReportInputSchema = z.object({ id: z.string().min(1).max(200) });

const getReportTool: ToolCallback<typeof GetReportInputSchema.shape> = async ({ id }, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/get_report', auth.userId, id, async () => {
    const report = await getReport(auth.db, id);
    if (!report) return toolError('Not found.');
    return toolSuccess(
      `${report.kind === 'weekly' ? 'Weekly' : 'Daily'} report ${reportPeriodLabel(report)} (${report.status}), prepared for ${report.preparedFor}.`,
      { report }
    );
  });
};

// =============================================================================
// list_projects
// =============================================================================

const ListProjectsInputSchema = z.object({});

const listProjectsTool: ToolCallback<typeof ListProjectsInputSchema.shape> = async (_args, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/list_projects', auth.userId, undefined, async () => {
    const projects = await listProjects(auth.db);
    return toolSuccess(`Found ${projects.length} project(s).`, { projects });
  });
};

// =============================================================================
// get_week_rollup
// =============================================================================

const GetWeekRollupInputSchema = z.object({ week_start: isoDate });

/** Seeds an aggregation accumulator for a given Monday-anchored week -- shared by `get_week_rollup` (read-only preview) and `create_weekly_from_dailies` (the same shape, persisted). */
function seedWeekDraft(weekStart: string, weekEnd: string, overrides?: { preparedFor?: string; preparedBy?: string }): Draft {
  const blank = blankDraft();
  return {
    ...blank,
    weekStart,
    weekEnd,
    preparedFor: overrides?.preparedFor ?? blank.preparedFor,
    preparedBy: overrides?.preparedBy ?? blank.preparedBy,
  };
}

const getWeekRollupTool: ToolCallback<typeof GetWeekRollupInputSchema.shape> = async ({ week_start }, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  if (isoWeekday(week_start) !== 1) {
    return toolError(`week_start must be a Monday (yyyy-mm-dd) -- "${week_start}" is not.`);
  }
  return withServiceErrors('mcp/get_week_rollup', auth.userId, undefined, async () => {
    const week_end = addDaysISO(week_start, 6);
    const [weeklies, dailies] = await Promise.all([listReports(auth.db, 'weekly'), listReports(auth.db, 'daily')]);
    const sources = [...weeklies, ...dailies].filter((r) => overlapsRange(r, week_start, week_end));
    const { draft: rollup, log: merge_log } = aggregateReportsIntoDraft(sources, seedWeekDraft(week_start, week_end));
    return toolSuccess(`Rolled up ${sources.length} report(s) for the week of ${week_start}.`, {
      week_start,
      week_end,
      sources: sources.map(summarizeReport),
      rollup,
      merge_log,
    });
  });
};

// =============================================================================
// create_report
// =============================================================================

/**
 * A FLAT object (not `z.discriminatedUnion`), despite `kind`-discriminated
 * semantics -- deliberate, and NOT how this tool's input was first written.
 * `z.discriminatedUnion` validates correctly on `tools/call` (the SDK falls
 * back to the raw schema when its own object-schema normalizer can't
 * recognize a union), but `tools/list`'s JSON-Schema ADVERTISEMENT has no
 * such fallback: `normalizeObjectSchema` (the installed
 * `@modelcontextprotocol/sdk@1.26.0`'s `server/zod-compat.js`) only
 * recognizes a schema whose Zod-internal `def.type === 'object'`, which a
 * discriminated union's `def.type === 'union'` never satisfies -- so a
 * discriminated-union `inputSchema` silently advertises an EMPTY `{}` shape
 * to every MCP client, verified live against this exact schema before this
 * fix (`tools/list`'s `create_report` entry showed
 * `"inputSchema":{"type":"object","properties":{}}`, no fields at all). A
 * `.refine()` on a plain `z.object(...)`, by contrast, keeps
 * `def.type === 'object'` (verified directly against this repo's installed
 * `zod` package) -- normalizes correctly, and the cross-field
 * weekly/daily requirement below still enforces at parse time, it just no
 * longer appears IN the advertised JSON Schema (an inherent limitation of
 * JSON Schema itself, not something a differently-shaped Zod schema could
 * fix) -- the tool's own `description` spells out the two shapes in prose
 * to compensate.
 */
const CreateReportInputSchema = z
  .object({
    kind: z.enum(['weekly', 'daily']),
    /** Required (and only meaningful) when kind is "weekly". */
    week_start: isoDate.optional(),
    /** Required (and only meaningful) when kind is "weekly". */
    week_end: isoDate.optional(),
    /** Required (and only meaningful) when kind is "daily". */
    date: isoDate.optional(),
    prepared_for: z.string().min(1).max(500),
    prepared_by: z.string().min(1).max(500),
    status: ReportStatusSchema.optional().default('Draft'),
    summary_narrative: z.string().max(20_000).optional().default(''),
    tasks: z.array(McpTaskInputSchema).max(MAX_CHILD_ROWS).optional().default([]),
    risks: z.array(McpRiskInputSchema).max(MAX_CHILD_ROWS).optional().default([]),
    priorities: z.array(McpPriorityInputSchema).max(MAX_CHILD_ROWS).optional().default([]),
    win: WinInputSchema.optional(),
    touchpoints: TouchpointsInputSchema.optional(),
    project_id: z.string().max(200).nullish(),
    /** Bypasses the same-owner/same-period/same-prepared_for duplicate guard below -- see this tool's Notes in the plan. Defaults false: a retried call without this flag can only ever be refused, never double-create. */
    allow_duplicate: z.boolean().optional().default(false),
  })
  .refine((v) => (v.kind === 'weekly' ? Boolean(v.week_start && v.week_end) : Boolean(v.date)), {
    message: 'kind "weekly" requires week_start and week_end; kind "daily" requires date.',
  });

type CreateReportInput = z.infer<typeof CreateReportInputSchema>;

/** `input.week_start`/`week_end`/`date` are `string | undefined` at the type level (the schema can't express the cross-field requirement in TS types the way `z.discriminatedUnion` could) -- `CreateReportInputSchema`'s `.refine()` above guarantees the right ones are actually present by the time a handler ever sees a parsed value, so this narrows with a runtime-safe non-null assertion, not a blind cast. */
function periodFromCreateReportInput(input: CreateReportInput): { weekStart: string; weekEnd: string } | { date: string } {
  return input.kind === 'weekly' ? { weekStart: input.week_start!, weekEnd: input.week_end! } : { date: input.date! };
}

const createReportTool: ToolCallback<typeof CreateReportInputSchema.shape> = async (input, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/create_report', auth.userId, undefined, async () => {
    const period = periodFromCreateReportInput(input);
    const existing = await listReports(auth.db, input.kind);
    const needle = normalize(input.prepared_for);
    const samePeriod =
      'weekStart' in period
        ? (r: AnyReport) => r.kind === 'weekly' && r.weekStart === period.weekStart && r.weekEnd === period.weekEnd
        : (r: AnyReport) => r.kind === 'daily' && r.date === period.date;
    const duplicate = existing.find((r) => r.ownerId === auth.userId && samePeriod(r) && normalize(r.preparedFor) === needle);
    if (duplicate && !input.allow_duplicate) {
      return toolError(
        `You already have a ${input.kind} report for ${reportPeriodLabel(duplicate)} prepared for "${duplicate.preparedFor}" (id: ${duplicate.id}). Pass allow_duplicate: true to create another anyway, or use update_report to edit the existing one.`
      );
    }

    const id = uid(input.kind === 'daily' ? 'd' : 'r');
    const now = nowDate();
    const core = {
      id,
      status: input.status,
      preparedFor: input.prepared_for,
      preparedBy: input.prepared_by,
      createdAt: now,
      updatedAt: now,
      summaryNarrative: input.summary_narrative,
      tasks: input.tasks.map((t) => ({ id: uid('t'), client: t.client, projectId: t.project_id ?? undefined, task: t.task, status: t.status, deadline: t.deadline })),
      risks: input.risks.map((r) => ({ id: uid('rk'), client: r.client, projectId: r.project_id ?? undefined, severity: r.severity, description: r.description, nextStep: r.next_step })),
      priorities: input.priorities.map((p) => ({ id: uid('p'), text: p.text })),
      win: input.win ?? { stat: '', label: '', narrative: '' },
      touchpoints: input.touchpoints ?? { calls: 0, emails: 0, escalations: 0, narrative: '' },
      projectId: input.project_id ?? undefined,
    };
    const assembled: AnyReport = 'weekStart' in period ? { ...core, kind: 'weekly', ...period } : { ...core, kind: 'daily', ...period };

    // Belt-and-braces (mirrors lib/import.ts's identical post-assembly
    // check): every field above is already bounded by the Zod input shapes
    // this handler validated, so this should never fail in practice -- but
    // running the exact same wire-boundary schema the web POST /api/reports
    // route uses is what keeps this tool from EVER drifting into accepting
    // a shape that schema would reject.
    const parsed = AnyReportInputSchema.parse(assembled);
    await upsertReports(auth.db, [parsed]);
    const created = (await getReport(auth.db, id)) ?? assembled;
    return toolSuccess(`Created ${input.kind} report ${id} for ${reportPeriodLabel(created)}.`, { report: summarizeReport(created) });
  });
};

// =============================================================================
// update_report
// =============================================================================
// Deliberately reuses `ReportPatchSchema` VERBATIM (the plan's explicit
// instruction) -- its fields stay camelCase (`weekStart`, `summaryNarrative`,
// ...), unlike every other tool's snake_case input convention above. This
// asymmetry is intentional, not an oversight: reusing the exact schema
// `PATCH /api/reports/[id]` already validates against means there is only
// ONE definition of "what a report patch looks like" in this codebase, at
// the cost of `update_report` alone not matching this file's other tools'
// naming style -- documented here and in the Skill so it reads as a
// deliberate choice, not drift.
const UpdateReportInputSchema = ReportPatchSchema.extend({
  id: z.string().min(1).max(200),
  /** Optional on `ReportPatchSchema` (the web PATCH route treats a missing CAS as "skip the check"); REQUIRED here -- an MCP client is a blind model with no UI reload affordance, so `update_report` always forces read-before-write (call `get_report` first, pass its `updatedAt` back). */
  expectedUpdatedAt: z.string().min(1),
});

const updateReportTool: ToolCallback<typeof UpdateReportInputSchema.shape> = async ({ id, expectedUpdatedAt, ...patch }, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/update_report', auth.userId, id, async () => {
    const updated = await updateReport(auth.db, id, patch, { expectedUpdatedAt });
    return toolSuccess(`Updated report ${id}.`, { report: summarizeReport(updated), updatedAt: updated.updatedAt });
  });
};

// =============================================================================
// create_project
// =============================================================================

const CreateProjectInputSchema = z.object({ name: z.string().min(1).max(500) });

const createProjectTool: ToolCallback<typeof CreateProjectInputSchema.shape> = async ({ name }, extra) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  return withServiceErrors('mcp/create_project', auth.userId, undefined, async () => {
    const needle = normalize(name);
    const before = await listProjects(auth.db);
    const existing = before.find((p) => normalize(p.name) === needle);
    if (existing) {
      return toolSuccess(`Project "${existing.name}" already exists.`, { id: existing.id, name: existing.name, created: false });
    }
    try {
      const project = await ensureProject(auth.db, { id: uid('proj'), name });
      return toolSuccess(`Created project "${project.name}".`, { id: project.id, name: project.name, created: true });
    } catch (err) {
      // Lost a race against a concurrent create_project for the SAME name
      // (projects.name is UNIQUE) -- re-list and hand back the winner as
      // "already exists" rather than surfacing the raw conflict.
      if (err instanceof ServiceError && err.code === 'conflict') {
        const after = await listProjects(auth.db);
        const winner = after.find((p) => normalize(p.name) === needle);
        if (winner) return toolSuccess(`Project "${winner.name}" already exists.`, { id: winner.id, name: winner.name, created: false });
      }
      throw err;
    }
  });
};

// =============================================================================
// create_weekly_from_dailies
// =============================================================================

const CreateWeeklyFromDailiesInputSchema = z.object({
  week_start: isoDate,
  prepared_for: z.string().max(500).optional(),
  prepared_by: z.string().max(500).optional(),
});

const createWeeklyFromDailiesTool: ToolCallback<typeof CreateWeeklyFromDailiesInputSchema.shape> = async (
  { week_start, prepared_for, prepared_by },
  extra
) => {
  const auth = requireAuth(extra);
  if (!auth) return UNAUTHORIZED_RESULT;
  if (isoWeekday(week_start) !== 1) {
    return toolError(`week_start must be a Monday (yyyy-mm-dd) -- "${week_start}" is not.`);
  }
  return withServiceErrors('mcp/create_weekly_from_dailies', auth.userId, undefined, async () => {
    const week_end = addDaysISO(week_start, 6);
    const [weeklies, dailies] = await Promise.all([listReports(auth.db, 'weekly'), listReports(auth.db, 'daily')]);

    // Weekly-exists guard doubles as retry-idempotency (the plan's own
    // note): a retried call for a week that already produced a weekly just
    // returns that weekly's id instead of creating a second one.
    const existingWeekly = weeklies.find((r) => r.kind === 'weekly' && r.ownerId === auth.userId && r.weekStart === week_start);
    if (existingWeekly) {
      return toolError(
        `You already have a weekly report for the week of ${week_start} (id: ${existingWeekly.id}). Use update_report to edit it instead.`
      );
    }

    const overlappingDailies = dailies.filter((d) => overlapsRange(d, week_start, week_end));
    if (overlappingDailies.length === 0) {
      return toolError(`No daily reports found for the week of ${week_start} -- nothing to roll up.`);
    }

    const seed = seedWeekDraft(week_start, week_end, { preparedFor: prepared_for, preparedBy: prepared_by });
    const { draft: rollup, log: merge_log } = aggregateReportsIntoDraft(overlappingDailies, seed);

    const id = uid('r');
    const now = nowDate();
    const report = draftToReport(rollup, id, 'Draft', now);
    const parsed = AnyReportInputSchema.parse(report);
    await upsertReports(auth.db, [parsed]);
    const created = (await getReport(auth.db, id)) ?? report;

    return toolSuccess(
      `Created weekly draft ${id} for the week of ${week_start} from ${overlappingDailies.length} daily report(s).`,
      { id, rollup: created, merge_log, source_ids: overlappingDailies.map((d) => d.id) }
    );
  });
};

// =============================================================================
// Registration -- driven off MCP_TOOL_NAMES (see this file's header comment)
// =============================================================================

interface ToolDef {
  description: string;
  inputSchema: z.ZodRawShape | z.ZodTypeAny;
  cb: ToolCallback<never>;
}

const TOOL_DEFS: Record<McpToolName, ToolDef> = {
  list_reports: {
    description:
      'List weekly and/or daily reports across the whole organization (reads are org-wide by design -- every signed-in teammate can read every report, same as the web dashboard). Optionally filter by kind, prepared_for (exact match, case/whitespace-insensitive), and a week_start range.',
    inputSchema: ListReportsInputSchema.shape,
    cb: listReportsTool as ToolCallback<never>,
  },
  get_report: {
    description:
      'Fetch one report by id, including its tasks, risks, priorities, win, and touchpoints. Returns the same updatedAt value update_report requires as expectedUpdatedAt for its optimistic-concurrency check.',
    inputSchema: GetReportInputSchema.shape,
    cb: getReportTool as ToolCallback<never>,
  },
  list_projects: {
    description: 'List every project (id, name). Projects are shared reference data -- any signed-in teammate can read the full list.',
    inputSchema: ListProjectsInputSchema.shape,
    cb: listProjectsTool as ToolCallback<never>,
  },
  get_week_rollup: {
    description:
      'Preview (read-only, nothing is persisted) what a weekly report for the given Monday-anchored week WOULD look like if every weekly and daily report touching that week were merged together -- tasks/risks dedupe latest-wins, priorities dedupe first-wins, touchpoints sum, the win carries from the latest source that has one.',
    inputSchema: GetWeekRollupInputSchema.shape,
    cb: getWeekRollupTool as ToolCallback<never>,
  },
  create_report: {
    description:
      'Create a brand-new weekly or daily report that you own. Never accepts an id (one is generated). Refuses a likely duplicate (same kind, same period, same prepared_for, already yours) unless allow_duplicate is true.',
    inputSchema: CreateReportInputSchema,
    cb: createReportTool as ToolCallback<never>,
  },
  update_report: {
    description:
      'Patch an existing report you own. REQUIRES expectedUpdatedAt (call get_report first and pass its updatedAt back) -- a stale value is refused with a conflict so you never blindly overwrite a change you have not seen. Note: this tool\'s fields (id, expectedUpdatedAt, and every patch field) are camelCase, unlike every other tool here, which is snake_case -- it reuses the web app\'s own patch schema verbatim. A present tasks/risks/priorities array replaces the whole list, not a merge.',
    inputSchema: UpdateReportInputSchema.shape,
    cb: updateReportTool as ToolCallback<never>,
  },
  create_project: {
    description:
      'Ensure a project with this name exists -- idempotent by name (exact match, case/whitespace-insensitive): calling this again with the same name returns the existing project instead of creating a second one.',
    inputSchema: CreateProjectInputSchema.shape,
    cb: createProjectTool as ToolCallback<never>,
  },
  create_weekly_from_dailies: {
    description:
      'Create a new Draft weekly report for the given Monday-anchored week, built by merging every daily report touching that week (same merge rules as get_week_rollup). Refuses if you already own a weekly report for that week (returns its id instead) or if there are zero daily reports to roll up -- either way, nothing is persisted.',
    inputSchema: CreateWeeklyFromDailiesInputSchema.shape,
    cb: createWeeklyFromDailiesTool as ToolCallback<never>,
  },
};

/**
 * Registers all 8 tools on a freshly-constructed `McpServer` (called once
 * per inbound request in stateless mode -- see `app/api/[transport]/
 * route.ts`). Iterates `MCP_TOOL_NAMES` rather than 8 hand-written
 * `server.registerTool(...)` calls so "which names got registered" can
 * never silently drift from the canonical array by a copy-paste typo --
 * and the length/membership assertion after the loop makes that a loud
 * runtime failure (not just a lint nit) if `TOOL_DEFS` and
 * `MCP_TOOL_NAMES` are ever edited out of sync with each other.
 */
export function registerMcpTools(server: McpServer): void {
  const registered: string[] = [];
  for (const name of MCP_TOOL_NAMES) {
    const def = TOOL_DEFS[name];
    server.registerTool(name, { description: def.description, inputSchema: def.inputSchema as never }, def.cb);
    registered.push(name);
  }
  const canonical = [...MCP_TOOL_NAMES].sort();
  const actual = [...registered].sort();
  const matches = canonical.length === actual.length && canonical.every((n, i) => n === actual[i]);
  if (!matches) {
    throw new Error(`MCP tool registration drifted from MCP_TOOL_NAMES -- registered [${actual.join(', ')}], expected [${canonical.join(', ')}].`);
  }
}
