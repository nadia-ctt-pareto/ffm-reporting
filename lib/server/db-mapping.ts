// Phase 7b (M1): camelCase (TS domain) <-> snake_case (SQL row) translation.
// Server-only by convention -- nothing under components/ or client-facing
// lib/ may import lib/server/* (this whole directory only ever runs inside
// a Next.js Route Handler or a future Phase 8 MCP tool, both server
// contexts). Consumed by lib/server/reports-service.ts, never called
// directly by a route handler.
//
// This file is the ONE place that owns the read-side timestamp
// normalization (`toDomainTimestamp` below) -- Postgres returns `created_at`/
// `updated_at` as full timestamptz strings (e.g.
// "2026-07-13T00:00:00+00:00"), and `fmtDateShort`/`parseISO` (lib/
// format.ts) render "Jul NaN, 2026" if handed one un-sliced (see that
// file's Phase 7a doc comment -- `parseISO` now defensively slices too, but
// that's belt-and-suspenders, not the mechanism). Do not reintroduce a
// second `.slice(0, 10)` anywhere else in this codebase; reuse
// `toDomainTimestamp` from here instead (lib/server/reports-service.ts's
// `updateReport` does exactly this when constructing its post-write return
// value, rather than re-deriving the slice itself).

import { z } from 'zod';
import { AnyReportInputSchema } from '../schema/report';
import type { AnyReport, Priority, ReportStatus, Risk, RiskSeverity, Task, TaskStatus } from '../types';

/** Request-body shape for a report (never the row shape -- see lib/schema/api.ts's header comment). Re-exported from here since lib/server/reports-service.ts's `upsertReports` needs it for its `reports` parameter, and this is the natural "SQL boundary" home for it. */
export type AnyReportInput = z.infer<typeof AnyReportInputSchema>;

/** Postgres `date`/`timestamptz` columns arrive as plain strings over PostgREST -- never re-parsed into a JS `Date` (see CLAUDE.md "no Date-based timezone math"). Takes only the first 10 characters, matching `lib/format.ts`'s `parseISO` -- a no-op for an already-bare `yyyy-mm-dd` value. */
export function toDomainTimestamp(raw: string): string {
  return raw.slice(0, 10);
}

/**
 * Write-side counterpart of `toDomainTimestamp`: `replace_reports`'s own
 * NOTE (supabase/migrations/20260719000004_auth_ownership.sql, around the
 * `created_at`/`updated_at` columns) requires a FULLY-QUALIFIED ISO-8601
 * instant for its bare `::timestamptz` cast -- a bare `yyyy-mm-dd` is only
 * unambiguous there under the `date::timestamp at time zone 'UTC'` pattern
 * the migration itself uses for the column ALTER, not for an inline cast
 * inside the function body. A domain `createdAt`/`updatedAt` value is
 * always a bare `yyyy-mm-dd` (see lib/format.ts's `nowDate()`); this
 * upgrades it to midnight UTC on that calendar day. A value that already
 * looks like an instant (contains `T`, e.g. one this module itself
 * generated via `new Date().toISOString()` for `updateReport`'s fresh
 * `updated_at`) passes through unchanged.
 */
export function toUtcInstant(s: string): string {
  if (!s) return new Date().toISOString();
  return s.includes('T') ? s : `${s}T00:00:00Z`;
}

export interface TaskRow {
  id: string;
  report_id?: string;
  client: string;
  project_id: string | null;
  task: string;
  status: TaskStatus;
  deadline: string | null;
  /** Task completion date (supabase/migrations/20260725000014_task_completed_at.sql) -- a nullable `date` column, mapped exactly like `deadline` above (never the timestamptz normalization path -- see this file's header comment). */
  completed_at: string | null;
  position: number;
}

export interface RiskRow {
  id: string;
  report_id?: string;
  client: string;
  project_id: string | null;
  severity: RiskSeverity;
  description: string;
  next_step: string;
  position: number;
}

export interface PriorityRow {
  id: string;
  report_id?: string;
  text: string;
  position: number;
}

/** Shape of a `reports` row joined with its `tasks`/`risks`/`priorities` children (`select('*, tasks(*), risks(*), priorities(*)')`) -- see lib/server/reports-service.ts's `reportsQuery`. */
export interface ReportRow {
  id: string;
  kind: 'weekly' | 'daily';
  week_start: string | null;
  week_end: string | null;
  report_date: string | null;
  status: ReportStatus;
  prepared_for: string;
  prepared_by: string;
  summary_narrative: string;
  win_stat: string;
  win_label: string;
  win_narrative: string;
  touchpoint_calls: number;
  touchpoint_emails: number;
  touchpoint_escalations: number;
  touchpoints_narrative: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  owner_id: string | null;
  /**
   * Post-review hardening (BLOCKER 1, supabase/migrations/
   * 20260720000005_post_review_hardening.sql): `authenticated`'s SELECT
   * grant on `reports` now excludes this column entirely, so `reportsQuery`
   * (lib/server/reports-service.ts) never selects it and this field is
   * simply ABSENT from every row this type describes -- not present as
   * `null`. Kept out of this interface on purpose (rather than typed
   * `string | null` and always `undefined` in practice) so a future call
   * site can't accidentally write `row.share_token` and get a silent
   * `undefined` instead of a compile error. The only remaining read path is
   * `getShareToken()` below, which calls the new owner-or-admin-gated
   * `get_report_share_token` RPC instead of selecting the column directly.
   */
  tasks: TaskRow[];
  risks: RiskRow[];
  priorities: PriorityRow[];
}

/** `public.get_shared_report(token)`'s jsonb return shape -- already camelCase (see the RPC's own `jsonb_build_object` in supabase/migrations/20260719000004_auth_ownership.sql), unlike every other read path in this file. Deliberately has no `ownerId`/`shareToken` (the RPC never returns them). */
export interface SharedReportJson {
  id: string;
  kind: 'weekly' | 'daily';
  weekStart: string | null;
  weekEnd: string | null;
  date: string | null;
  status: ReportStatus;
  preparedFor: string;
  preparedBy: string;
  summaryNarrative: string;
  win: { stat: string; label: string; narrative: string };
  touchpoints: { calls: number; emails: number; escalations: number; narrative: string };
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  tasks: { id: string; client: string; projectId: string | null; task: string; status: TaskStatus; deadline: string | null }[];
  risks: { id: string; client: string; projectId: string | null; severity: RiskSeverity; description: string; nextStep: string }[];
  priorities: { id: string; text: string }[];
}

function byPosition<T extends { position: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

function mapTaskRow(t: TaskRow): Task {
  return {
    id: t.id,
    client: t.client,
    projectId: t.project_id ?? undefined,
    task: t.task,
    status: t.status,
    deadline: t.deadline ?? '',
    completedAt: t.completed_at ?? '',
  };
}

function mapRiskRow(r: RiskRow): Risk {
  return {
    id: r.id,
    client: r.client,
    projectId: r.project_id ?? undefined,
    severity: r.severity,
    description: r.description,
    nextStep: r.next_step,
  };
}

function mapPriorityRow(p: PriorityRow): Priority {
  return { id: p.id, text: p.text };
}

/**
 * SQL row (+ joined children) -> TS domain `AnyReport`. Children are
 * sorted by `position` DEFENSIVELY here even though the query itself
 * already orders each embedded table by `position` (see reports-service.ts)
 * -- cheap insurance against a future call site that queries `reports`
 * without that `.order()` and silently scrambles task/risk/priority order.
 * `createdAt`/`updatedAt` are the ONLY fields passed through
 * `toDomainTimestamp` -- see this file's header comment.
 */
export function rowToReport(row: ReportRow): AnyReport {
  const core = {
    id: row.id,
    status: row.status,
    preparedFor: row.prepared_for,
    preparedBy: row.prepared_by,
    createdAt: toDomainTimestamp(row.created_at),
    updatedAt: toDomainTimestamp(row.updated_at),
    summaryNarrative: row.summary_narrative,
    tasks: byPosition(row.tasks).map(mapTaskRow),
    risks: byPosition(row.risks).map(mapRiskRow),
    win: { stat: row.win_stat, label: row.win_label, narrative: row.win_narrative },
    touchpoints: {
      calls: row.touchpoint_calls,
      emails: row.touchpoint_emails,
      escalations: row.touchpoint_escalations,
      narrative: row.touchpoints_narrative,
    },
    priorities: byPosition(row.priorities).map(mapPriorityRow),
    projectId: row.project_id ?? undefined,
    ownerId: row.owner_id ?? undefined,
    // No `shareToken` key here -- see ReportRow.share_token's doc comment
    // above. `AnyReportSchema`'s `shareToken` field is `.nullish()`
    // (optional key), so an absent key here is a valid, honest `AnyReport`
    // -- this is what actually stops share_token from leaking through
    // `GET /api/reports`/`GET /api/reports/[id]` (BLOCKER 1).
  };
  return row.kind === 'daily'
    ? { ...core, kind: 'daily', date: row.report_date ?? '' }
    : { ...core, kind: 'weekly', weekStart: row.week_start ?? '', weekEnd: row.week_end ?? '' };
}

/** `get_shared_report`'s jsonb -> TS domain `AnyReport`. Same `toDomainTimestamp` normalization as `rowToReport`; children are already SQL-ordered by `position` inside the RPC's own `jsonb_agg(... order by ...)` (no raw `position` column survives into the jsonb, so there is nothing to defensively re-sort by here). */
export function sharedJsonToReport(json: SharedReportJson): AnyReport {
  const core = {
    id: json.id,
    status: json.status,
    preparedFor: json.preparedFor,
    preparedBy: json.preparedBy,
    createdAt: toDomainTimestamp(json.createdAt),
    updatedAt: toDomainTimestamp(json.updatedAt),
    summaryNarrative: json.summaryNarrative,
    tasks: json.tasks.map((t) => ({ id: t.id, client: t.client, projectId: t.projectId ?? undefined, task: t.task, status: t.status, deadline: t.deadline ?? '' })),
    risks: json.risks.map((r) => ({
      id: r.id,
      client: r.client,
      projectId: r.projectId ?? undefined,
      severity: r.severity,
      description: r.description,
      nextStep: r.nextStep,
    })),
    win: json.win,
    touchpoints: json.touchpoints,
    priorities: json.priorities.map((p) => ({ id: p.id, text: p.text })),
    projectId: json.projectId ?? undefined,
  };
  return json.kind === 'daily'
    ? { ...core, kind: 'daily', date: json.date ?? '' }
    : { ...core, kind: 'weekly', weekStart: json.weekStart ?? '', weekEnd: json.weekEnd ?? '' };
}

/**
 * TS domain (`AnyReportInput`, or a merged `AnyReport` -- a superset, see
 * lib/server/reports-service.ts's `updateReport`) -> the `replace_reports`
 * RPC's payload row shape (supabase/migrations/20260719000004_auth_ownership.sql's
 * header comment documents the exact keys expected). Deliberately never
 * emits `owner_id`: on a brand-new insert the RPC defaults it to the
 * caller's own `auth.uid()` (correct -- the creator becomes the owner);
 * on an update (an existing `id`, taking the `on conflict do update` path)
 * the RPC's `SET` list never touches `owner_id` at all, so omitting it here
 * is what "preserve the existing owner" (docs/database-schema.md) actually
 * reduces to -- there is no owner_id to send, update or otherwise.
 * `share_token` is never part of this payload at all (see the RPC's own
 * NOTE) -- enable/revoke are separate RPCs (`enableShare`/`revokeShare`,
 * reports-service.ts). No `position` field is emitted on any child row --
 * `replace_reports` derives it itself from array order via
 * `jsonb_array_elements(...) with ordinality`.
 */
export function reportToRow(report: AnyReportInput) {
  const isWeekly = report.kind === 'weekly';
  return {
    id: report.id,
    kind: report.kind,
    week_start: isWeekly ? report.weekStart : null,
    week_end: isWeekly ? report.weekEnd : null,
    report_date: isWeekly ? null : report.date,
    status: report.status,
    prepared_for: report.preparedFor,
    prepared_by: report.preparedBy,
    summary_narrative: report.summaryNarrative,
    win_stat: report.win.stat,
    win_label: report.win.label,
    win_narrative: report.win.narrative,
    touchpoint_calls: report.touchpoints.calls,
    touchpoint_emails: report.touchpoints.emails,
    touchpoint_escalations: report.touchpoints.escalations,
    touchpoints_narrative: report.touchpoints.narrative,
    created_at: toUtcInstant(report.createdAt),
    updated_at: toUtcInstant(report.updatedAt),
    project_id: report.projectId ?? null,
    tasks: report.tasks.map((t) => ({
      id: t.id,
      client: t.client,
      project_id: t.projectId ?? null,
      task: t.task,
      status: t.status,
      deadline: t.deadline || null,
      completed_at: t.completedAt || null,
    })),
    risks: report.risks.map((r) => ({ id: r.id, client: r.client, project_id: r.projectId ?? null, severity: r.severity, description: r.description, next_step: r.nextStep })),
    priorities: report.priorities.map((p) => ({ id: p.id, text: p.text })),
  };
}
