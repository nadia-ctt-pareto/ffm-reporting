// Phase 7b (M1): the data-plane service functions every `/api/reports*`/
// `/api/projects` route handler (and, eventually, Phase 8's MCP tools) call
// into. Every exported function takes the Supabase client it must run AS --
// this module NEVER constructs a client itself and MUST NEVER be handed a
// service-role client. Its correctness assumes RLS (supabase/migrations/
// 20260719000004_auth_ownership.sql) is what enforces access; a
// service-role client bypasses RLS entirely, which would silently turn
// every function below into an unscoped admin operation. Route handlers
// pass the cookie-bound client from `createServerSupabase()`
// (lib/supabase/server.ts); Phase 8's MCP tools will pass an
// api-token-derived, user-scoped client -- same contract, same functions,
// no server-role key anywhere in this file.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportPatch } from '../schema/api';
import { AnyReportSchema } from '../schema/report';
import type { AnyReport, Project, ReportKind } from '../types';
import {
  reportToRow,
  rowToReport,
  sharedJsonToReport,
  toDomainTimestamp,
  type AnyReportInput,
  type ReportRow,
  type SharedReportJson,
} from './db-mapping';

export type ServiceErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'internal';

export class ServiceError extends Error {
  code: ServiceErrorCode;
  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

/**
 * Post-review hardening (SHOULD-FIX 5): every route handler previously did
 * `NextResponse.json({ error: err.message })` for ANY `ServiceError`, and
 * `mapPgError` below routed every non-curated Postgres error into
 * `ServiceError('invalid', message)` -- so a raw PG error string (e.g.
 * `duplicate key value violates unique constraint
 * "reports_one_daily_per_day"`, or `new row violates row-level security
 * policy for table "reports"`) was reflected straight into the client and
 * rendered verbatim in the wizard's error banner / CSV importer's issue
 * list. Two problems compounded: internals leaked to the client, AND
 * anything that didn't match a curated `code` got HTTP 400 (client error)
 * instead of 500 (server error) -- a connection failure or planner error is
 * not the client's fault.
 *
 * Post-review hardening round 2 (SHOULD-FIX D): exported, and now the
 * SINGLE call site is `lib/server/route-helpers.ts`'s `handleServiceError`
 * -- see this file's `mapPgError` and that file's header comment for why
 * curating a SECOND time (once here, once there) was actively wrong for the
 * `'conflict'` branch below, and why five OTHER call sites in this file
 * (`mapRow`, `updateReport`, `enableShare`, `getSharedReport`,
 * `ensureProject`) never ran their message through this function at all,
 * silently shipping internal detail (a raw schema-drift message, a
 * client-reflected id) straight to the wire. `handleServiceError` now runs
 * this UNCONDITIONALLY over every `ServiceError.message`, so a future
 * direct `ServiceError` construction anywhere in this file can never leak
 * detail by omission again -- there is no second place to remember to
 * curate.
 */
export function curatedMessage(code: ServiceErrorCode, rawMessage: string): string {
  switch (code) {
    case 'forbidden':
      return "You don't have permission to do that.";
    case 'conflict':
      if (/reports_one_daily_per_day/.test(rawMessage)) {
        return 'A daily report for this date already exists.';
      }
      // Phase 8c: `renameProject`'s `.update({name})` -> mapPgError already
      // routes a 23505 (unique-violation) here; this is the ONLY curation
      // point that turns Postgres's raw "duplicate key value violates
      // unique constraint \"projects_name_key\"" into user-facing copy.
      if (/projects_name_key/.test(rawMessage)) {
        return 'A project with this name already exists.';
      }
      // Phase 8c: `deleteProject` constructs this 'conflict' ServiceError
      // itself (see that function's own doc comment for why it intercepts
      // sqlstate 23503 BEFORE mapPgError's generic mapping) -- the raw
      // Postgres FK-violation message names whichever of
      // reports_project_id_fkey/tasks_project_id_fkey/risks_project_id_fkey
      // fired; this regex matches all three without hardcoding table names.
      if (/_project_id_fkey/.test(rawMessage)) {
        return 'This project is still referenced by existing reports.';
      }
      return 'This was changed by someone else since you loaded it. Reload and try again.';
    case 'not_found':
      return 'Not found.';
    case 'unauthorized':
      return 'You must be signed in to do that.';
    case 'invalid':
      // Phase 7c (BYOK AI polish): marker-token matches, NOT new
      // ServiceErrorCode members -- see lib/server/ai-polish.ts's header
      // comment for why every AI failure reuses this existing 'invalid'/
      // 'internal' scheme instead of a parallel error type. BYOK
      // generalization added the `openai_*`/`local_rate_limited` markers
      // below, alongside the ORIGINAL, unchanged `anthropic_*` ones.
      if (/anthropic_invalid_key/.test(rawMessage)) {
        return 'Your Anthropic key was rejected -- update it in Settings.';
      }
      if (/anthropic_rate_limited/.test(rawMessage)) {
        return 'Your Anthropic account is rate-limited -- try again in a minute.';
      }
      if (/openai_invalid_key/.test(rawMessage)) {
        return 'Your API key was rejected -- update it in Settings.';
      }
      if (/openai_bad_endpoint/.test(rawMessage)) {
        return 'Check the base URL and model, then try again.';
      }
      if (/openai_rate_limited/.test(rawMessage)) {
        return 'The provider rate-limited this request -- try again in a minute.';
      }
      if (/local_rate_limited/.test(rawMessage)) {
        return "You've made too many polish requests -- try again in a minute.";
      }
      if (/ai_key_unreadable/.test(rawMessage)) {
        return 'Your stored key can no longer be read -- re-enter it in Settings.';
      }
      return "That request couldn't be processed -- check the values and try again.";
    case 'internal':
      if (/anthropic_unavailable|anthropic_timeout/.test(rawMessage)) {
        return "Couldn't reach Anthropic -- your text is unchanged.";
      }
      if (/openai_unavailable|openai_timeout|provider_unavailable/.test(rawMessage)) {
        return "Couldn't reach the provider -- your text is unchanged.";
      }
      return 'Something went wrong on our end. Please try again.';
    default:
      return 'Something went wrong on our end. Please try again.';
  }
}

/** Loosely-typed Postgres/PostgREST error shape -- `SupabaseClient` isn't generated against this project's schema, so `.rpc()`/query-builder results are effectively `any`; this is the one place that narrows an error object into a `ServiceError`. Branches on `code` (Postgres SQLSTATE, e.g. `42501`) first, falling back to a message-text match, per PostgrestError's own doc comment recommendation ("branch on `code` rather than on `message` text") -- the fallback exists because RLS violations surfaced through `replace_reports` (SECURITY INVOKER) don't always carry a clean `code`. Anything that doesn't match a KNOWN, expected condition (RLS denial, unique violation, check/FK violation) maps to `'internal'` (-> HTTP 500), not `'invalid'` (-> HTTP 400) -- an unrecognized DB error is a server problem, not a malformed request.
 *
 * Post-review hardening round 2 (SHOULD-FIX D): the constructed
 * `ServiceError`'s `.message` is the RAW PG text again (reverted from the
 * round-1 version, which pre-curated it here) -- `curatedMessage` now runs
 * EXACTLY ONCE, in `route-helpers.ts`'s `handleServiceError`. Pre-curating
 * here too was actively wrong for the `'conflict'` branch: that code's
 * `curatedMessage` case pattern-matches the RAW text for
 * `reports_one_daily_per_day` to choose between two different user-facing
 * strings -- if this function had already replaced the message with the
 * CURATED text, a second `curatedMessage` call downstream would find no
 * such substring in it and silently fall back to the generic default,
 * downgrading a precise message every single time. The raw message is still
 * fully captured server-side regardless -- the `console.error` immediately
 * below logs it directly, independent of what ends up on `ServiceError`. */
function mapPgError(error: { code?: string; message?: string } | null | undefined): ServiceError {
  const sqlstate = error?.code ?? '';
  const message = error?.message ?? 'Unexpected database error.';
  let code: ServiceErrorCode;
  if (sqlstate === '42501' || /row-level security|permission denied/i.test(message)) {
    code = 'forbidden';
  } else if (sqlstate === '23505') {
    code = 'conflict';
  } else if (sqlstate === '23514' || sqlstate === '23503') {
    code = 'invalid';
  } else {
    code = 'internal';
  }
  // Deliberate server-side audit log, see doc comment above; never sent to the client.
  console.error('[reports-service] Postgres error', { sqlstate, message, mappedCode: code });
  return new ServiceError(code, message);
}

/**
 * Post-review hardening (SHOULD-FIX 5, second half): route handlers'
 * `errorResponse()` checked `instanceof ServiceError` FIRST and returned
 * immediately, so every 403/409/400 -- exactly the security-relevant events
 * (a non-owner PATCH, a duplicate-key conflict, a validation rejection) --
 * was invisible in server logs, while only genuinely unexpected errors
 * logged. Route handlers call this alongside `errorResponse()` so denials
 * are auditable too. Deliberately NOT called from inside `mapPgError`
 * itself (which already logs the raw PG error) -- this logs the
 * HTTP-facing outcome (status code, curated message, which user/report)
 * once per request, at the one place that has that context.
 */
export function logServiceError(err: ServiceError, context: { userId?: string; reportId?: string; route: string }): void {
  // Deliberate server-side audit log for every 401/403/404/409/400 the API returns.
  console.warn('[reports-service] ServiceError', { code: err.code, message: err.message, ...context });
}

/** Explicit column list, NOT `select('*', ...)` -- Postgres treats `SELECT *` as equivalent to naming every column, so it fails outright (42501) once `authenticated`'s column-level grant on `reports` excludes `share_token` (supabase/migrations/20260720000005_post_review_hardening.sql, BLOCKER 1). This list is exactly that grant's column list. `share_token` is deliberately never selected here -- see `getShareToken` below for the only remaining read path. `owner_id` IS included/broadcast to every authenticated user -- a deliberate decision (SHOULD-FIX I, post-review round 2), not an oversight; see `ReportCoreSchema.ownerId`'s doc comment (lib/schema/report.ts) for the rationale. */
const REPORT_COLUMNS =
  'id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by, ' +
  'summary_narrative, win_stat, win_label, win_narrative, ' +
  'touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative, ' +
  'created_at, updated_at, project_id, owner_id';

function reportsQuery(db: SupabaseClient) {
  return db
    .from('reports')
    .select(`${REPORT_COLUMNS}, tasks(*), risks(*), priorities(*)`)
    .order('position', { referencedTable: 'tasks' })
    .order('position', { referencedTable: 'risks' })
    .order('position', { referencedTable: 'priorities' });
}

/**
 * `rowToReport` + the drift guard, WITHOUT throwing -- logs and returns
 * `null` on a failed parse. See `mapRow`/`listReports` below for the two
 * different things a caller might want to do with that.
 */
function safeMapRow(row: ReportRow): AnyReport | null {
  const mapped = rowToReport(row);
  const parsed = AnyReportSchema.safeParse(mapped);
  if (!parsed.success) {
    console.error('[reports-service] rowToReport produced a value that failed AnyReportSchema -- schema/DB drift?', {
      id: row.id,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

/**
 * `safeMapRow` + the drift guard (see the plan's "Semantics that matter" --
 * a failed parse is a logged 500, never silently served). Post-review fix
 * (adjacent to SHOULD-FIX 5): this used to throw `ServiceError('invalid',
 * ...)`, which `statusForServiceError` maps to HTTP 400 -- contradicting
 * this very doc comment's "a logged 500" claim. A schema/DB drift is a
 * SERVER bug (the row Postgres returned doesn't match what the app expects),
 * never a malformed CLIENT request, so it maps to `'internal'` (-> 500) now,
 * matching every other genuinely-unexpected condition (see `mapPgError`).
 *
 * Used by every SINGLE-row read path (`getReport`, `updateReport`'s own
 * re-read) where "the one report the caller asked for is unreadable" IS the
 * correct, narrowly-scoped failure -- `listReports` below deliberately does
 * NOT use this (see BLOCKER A, round 2).
 */
function mapRow(row: ReportRow): AnyReport {
  const mapped = safeMapRow(row);
  if (mapped) return mapped;
  throw new ServiceError('internal', `Report ${row.id} failed to validate after mapping from Postgres.`);
}

export async function listReports(db: SupabaseClient, kind?: ReportKind): Promise<AnyReport[]> {
  let query = reportsQuery(db);
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw mapPgError(error);
  // BLOCKER A, part 3 (post-review round 2): skip-and-log a single
  // non-conforming row instead of throwing for the WHOLE batch (the
  // previous `.map(mapRow)` did exactly that -- one poisoned row 500'd this
  // list for every user in the org, including admins, with no in-app
  // recovery). `safeMapRow` already logs the drift server-side; degrading
  // to "one report missing from the list" instead of "the whole list is
  // down" is the point -- this is a backstop for a schema/DB disagreement
  // this app doesn't currently expect to exist at all (see the SQL CHECK
  // constraints landed alongside this fix), not a substitute for keeping
  // them in sync.
  return ((data ?? []) as ReportRow[]).map(safeMapRow).filter((r): r is AnyReport => r !== null);
}

export async function getReport(db: SupabaseClient, id: string): Promise<AnyReport | null> {
  const { data, error } = await reportsQuery(db).eq('id', id).maybeSingle();
  if (error) throw mapPgError(error);
  if (!data) return null;
  return mapRow(data as ReportRow);
}

/** ONE `replace_reports` RPC call for the whole batch -- see CLAUDE.md's "upsertMany must be ONE POST -> ONE replace_reports call -> one transaction" (the Phase 6b data-loss bug this exists to prevent). */
export async function upsertReports(
  db: SupabaseClient,
  reports: AnyReportInput[],
  opts?: { skipExisting?: boolean }
): Promise<{ imported: string[]; skipped: string[] }> {
  if (reports.length === 0) return { imported: [], skipped: [] };
  const payload = reports.map((r) => reportToRow(r));
  const { data, error } = await db.rpc('replace_reports', { payload, skip_existing: opts?.skipExisting ?? false });
  if (error) throw mapPgError(error);
  const result = (data ?? {}) as { imported?: string[]; skipped?: string[] };
  return { imported: result.imported ?? [], skipped: result.skipped ?? [] };
}

/**
 * Read -> optional CAS -> shallow-merge `patch` onto the mapped domain
 * object (a present `tasks`/`risks`/`priorities` array replaces the whole
 * list -- this is how the Kanban board's `{ tasks: [...] }` patch lands) ->
 * `replace_reports([merged])`, which server-stamps `updated_at = now()`
 * itself (supabase/migrations/20260720000005_post_review_hardening.sql) --
 * this function no longer guesses that value. Exactly two round-trips: this
 * read, and the write below (no third re-fetch) -- `replace_reports` now
 * RETURNS the real, just-written `updated_at` for every id it touched (see
 * that migration's follow-up), which is what `updateReport` echoes back.
 *
 * SHOULD-FIX C (post-review round 2): two independent bugs fixed together
 * here, both about `updated_at` --
 *
 * 1. The CAS compared `opts.expectedUpdatedAt` against the RAW,
 *    full-precision `row.updated_at` (e.g.
 *    "2026-07-20T20:02:17.440317+00:00"). NO client can ever have seen that
 *    value: every `updatedAt` this API (or the domain layer generally) ever
 *    emits is already `toDomainTimestamp`-sliced to `yyyy-mm-dd` -- so this
 *    CAS was permanently unsatisfiable for any real caller, including
 *    Phase 8's `update_report` MCP tool, which is specified to depend on it.
 *    It now compares against `toDomainTimestamp(row.updated_at)` instead --
 *    the SAME value a prior `GET`/list response would have returned for
 *    this report, so a caller can actually supply a matching one. This
 *    trades sub-day precision (two writes to the same report on the same
 *    UTC day are indistinguishable to this CAS) for the CAS being usable at
 *    all, which it never was before.
 * 2. This function used to fabricate its returned `updatedAt` from
 *    `new Date().toISOString()` -- THIS NODE PROCESS'S clock, not
 *    Postgres's. That was merely unused dead weight while the return value
 *    was discarded, but `useReports.ts` (SHOULD-FIX 14, same phase) now
 *    writes the returned object straight into React state, so a client/DB
 *    clock-skew or a request straddling a UTC-midnight boundary could show
 *    the user a date the row doesn't actually have. Fixed by echoing the
 *    value `replace_reports` itself reports having written, never a
 *    process-local guess.
 */
export async function updateReport(
  db: SupabaseClient,
  id: string,
  patch: ReportPatch,
  opts?: { expectedUpdatedAt?: string }
): Promise<AnyReport> {
  const { data: existingRow, error: readError } = await reportsQuery(db).eq('id', id).maybeSingle();
  if (readError) throw mapPgError(readError);
  // SHOULD-FIX D (post-review round 2): this message carries the
  // client-supplied `id` and was previously returned to the client
  // verbatim (a PATCH to `/api/reports/<script>...` echoed the raw string
  // back). It's diagnostic-only now -- `route-helpers.ts`'s
  // `handleServiceError` curates every `ServiceError.message` before it
  // reaches the wire, so a caller only ever sees "Not found." regardless of
  // what `id` was supplied; this string still reaches the server log via
  // `logServiceError`, where the id IS useful context.
  if (!existingRow) throw new ServiceError('not_found', `Report ${id} not found.`);
  const row = existingRow as ReportRow;

  if (opts?.expectedUpdatedAt !== undefined && opts.expectedUpdatedAt !== toDomainTimestamp(row.updated_at)) {
    throw new ServiceError(
      'conflict',
      `Optimistic concurrency check failed for report ${id}: expectedUpdatedAt "${opts.expectedUpdatedAt}" did not match the stored updatedAt.`
    );
  }

  // Defensively drop `expectedUpdatedAt` even though the one real call site
  // (app/api/reports/[id]/route.ts) already destructures it out of the
  // parsed body before calling this function -- it's a `ReportPatchSchema`
  // field, not a `ReportCore` one, and must never survive into `merged`.
  const { expectedUpdatedAt, ...corePatch } = patch;
  void expectedUpdatedAt;
  const existing = mapRow(row);
  const merged = { ...existing, ...corePatch } as AnyReport;

  const { data, error: writeError } = await db.rpc('replace_reports', { payload: [reportToRow(merged)], skip_existing: false });
  if (writeError) throw mapPgError(writeError);

  const result = (data ?? {}) as { updatedAt?: Record<string, string> };
  const writtenUpdatedAt = result.updatedAt?.[id];
  if (!writtenUpdatedAt) {
    throw new ServiceError('internal', `replace_reports did not return an updated_at for report ${id}.`);
  }
  return { ...merged, updatedAt: toDomainTimestamp(writtenUpdatedAt) };
}

/** Owner-or-admin-only (enforced INSIDE the SECURITY DEFINER RPC, not here -- see supabase/migrations/20260719000004_auth_ownership.sql). Returns the freshly-generated token. */
export async function enableShare(db: SupabaseClient, reportId: string): Promise<string> {
  const { data, error } = await db.rpc('enable_report_share', { p_report_id: reportId });
  if (error) throw mapPgError(error);
  if (typeof data !== 'string' || data.length === 0) {
    // Diagnostic-only (SHOULD-FIX D, post-review round 2) -- curated to a
    // generic message by `handleServiceError` before it reaches the wire.
    throw new ServiceError('invalid', 'enable_report_share returned an unexpected result.');
  }
  return data;
}

export async function revokeShare(db: SupabaseClient, reportId: string): Promise<void> {
  const { error } = await db.rpc('revoke_report_share', { p_report_id: reportId });
  if (error) throw mapPgError(error);
}

/**
 * BLOCKER 1 fix: the ONLY read path for a report's `share_token` now that
 * `authenticated`'s column-level SELECT grant on `reports` excludes it
 * (supabase/migrations/20260720000005_post_review_hardening.sql) --
 * `reportsQuery`/`listReports`/`getReport` above can never see this column
 * again. Owner-or-admin-only, enforced INSIDE the new
 * `get_report_share_token` SECURITY DEFINER RPC (same migration), mirroring
 * `enableShare`/`revokeShare`'s ownership check exactly. Returns `null` when
 * sharing isn't enabled for this report (never throws for that case) --
 * `GET /api/reports/[id]/share` is the route handler this powers, designed
 * for Milestone M3's ShareDialog to call before rendering an Enable/Copy/
 * Revoke state.
 */
export async function getShareToken(db: SupabaseClient, reportId: string): Promise<string | null> {
  const { data, error } = await db.rpc('get_report_share_token', { p_report_id: reportId });
  if (error) throw mapPgError(error);
  return (data as string | null) ?? null;
}

/**
 * The ONLY anon-reachable report read (Decision 1, supabase/migrations/
 * 20260719000004_auth_ownership.sql). Callers MUST pass a bare,
 * cookie-less anon client here -- never the cookie-bound session client --
 * so a signed-in user's own session can never accidentally satisfy a wrong/
 * missing token (this is enforced by the CALLER, not this function; see
 * app/reports/[id]/present/page.tsx, Phase 7b M3). Takes a token, never an
 * id.
 */
export async function getSharedReport(db: SupabaseClient, token: string): Promise<AnyReport | null> {
  const { data, error } = await db.rpc('get_shared_report', { token });
  if (error) throw mapPgError(error);
  if (!data) return null;
  const mapped = sharedJsonToReport(data as SharedReportJson);
  const parsed = AnyReportSchema.safeParse(mapped);
  if (!parsed.success) {
    console.error('[reports-service] sharedJsonToReport produced a value that failed AnyReportSchema -- schema/DB drift?', parsed.error.issues);
    // SHOULD-FIX D (post-review round 2): 'internal' (-> 500), not
    // 'invalid' (-> 400) -- the identical schema/DB-drift condition in
    // `mapRow` above was deliberately fixed to 'internal' for the same
    // reason (a mismatch between what Postgres returned and what this app
    // expects is a SERVER bug, never a malformed client request); this call
    // site was inconsistent with that fix. The message itself is also no
    // longer sent to the client verbatim -- see `route-helpers.ts`'s
    // `handleServiceError`, the one place that now curates every
    // `ServiceError` before it reaches the wire.
    throw new ServiceError('internal', 'sharedJsonToReport produced a value that failed AnyReportSchema.');
  }
  return parsed.data;
}

export async function listProjects(db: SupabaseClient): Promise<Project[]> {
  const { data, error } = await db.from('projects').select('id, name').order('name', { ascending: true });
  if (error) throw mapPgError(error);
  return (data ?? []) as Project[];
}

/**
 * Insert-or-return-existing -- deliberately NEVER an UPDATE.
 * `projects_update` RLS is admin-only (supabase/migrations/
 * 20260719000004_auth_ownership.sql), and "ensure this project exists" is
 * all the CSV importer and the localStorage import (Phase 7b M4) actually
 * need; renaming an existing project is out of scope for every caller of
 * this function. This is a genuine semantic difference from
 * `LocalStorageReportsRepository.upsertProject` (replace-by-id, i.e. a
 * rename IS possible there) -- document, don't paper over: a client that
 * relies on `upsertProject` renaming an existing project will observe
 * different behavior once `HttpReportsRepository` is in play (see that
 * file's `upsertProject`).
 */
export async function ensureProject(db: SupabaseClient, project: Project): Promise<Project> {
  const { error: upsertError } = await db.from('projects').upsert(project, { onConflict: 'id', ignoreDuplicates: true });
  if (upsertError) throw mapPgError(upsertError);
  const { data, error } = await db.from('projects').select('id, name').eq('id', project.id).maybeSingle();
  if (error) throw mapPgError(error);
  // SHOULD-FIX D (post-review round 2): reflects the client-supplied
  // `project.id` -- diagnostic-only now, see updateReport's identical note
  // above. `handleServiceError` curates this before it reaches the wire.
  if (!data) throw new ServiceError('invalid', `Failed to ensure project ${project.id} -- upsert reported no error but the follow-up read found nothing.`);
  return data as Project;
}

/**
 * Phase 8c: renames EXACTLY the `name` column -- see `app/api/projects/[id]/route.ts`'s
 * PATCH handler (the only caller) and CLAUDE.md's "THE CRUX -- rename
 * safety". Row-level access is `projects_update` RLS (admin-only,
 * unchanged -- supabase/migrations/20260719000004_auth_ownership.sql);
 * column-level access is the new grant in
 * supabase/migrations/20260724000011_project_management.sql (`authenticated`
 * may UPDATE `name` only, never `id`, even for an admin). Neither guard is
 * re-implemented here -- this function just issues the UPDATE and lets
 * Postgres enforce both.
 *
 * `.update({ name })` -- NOT `.update(project)` or any other shape that
 * could carry an `id` field -- is itself a belt-and-braces guard: even if a
 * future caller accidentally passed a whole `Project` object here, only
 * `name` would ever be spread into this call's own object literal.
 *
 * `!data` (RLS filtered every row, OR the id genuinely doesn't exist) maps
 * to 'not_found' -- see this file's `updateReport` for the identical
 * `.maybeSingle()` "0 rows, no error" pattern. A 23505 (another project
 * already has this exact name -- `projects_name_key`) flows through
 * `mapPgError` -> 'conflict', curated by `curatedMessage` above.
 */
export async function renameProject(db: SupabaseClient, id: string, name: string): Promise<Project> {
  const { data, error } = await db.from('projects').update({ name }).eq('id', id).select('id, name').maybeSingle();
  if (error) throw mapPgError(error);
  // Diagnostic-only (see updateReport's identical note) -- curated to "Not found." before it reaches the wire.
  if (!data) throw new ServiceError('not_found', `Project ${id} not found (or not permitted).`);
  return data as Project;
}

/**
 * Phase 8c: deletes a project ONLY when unreferenced -- the
 * `reports`/`tasks`/`risks`.`project_id` FK (`NO ACTION`, no `ON DELETE
 * CASCADE`/`SET NULL` anywhere in this schema) is the sole authority for
 * that rule; this function does not duplicate it with an application-level
 * "is this referenced?" check of its own. Row-level access is
 * `projects_delete` RLS (admin-only, unchanged).
 *
 * Sqlstate 23503 (foreign-key violation -- the project IS referenced) is
 * intercepted HERE, before `mapPgError`'s generic mapping: that function
 * maps 23503 -> 'invalid' (400) for every OTHER caller in this file (e.g.
 * `replace_reports` rejecting a report that names a nonexistent
 * `project_id` -- a genuinely malformed request), but a referenced
 * project's delete being blocked is a 'conflict' (409, "this can't proceed
 * because other data depends on it"), not a malformed request -- so this
 * one case can't share `mapPgError`'s blanket 23503 branch.
 *
 * `.select('id')` after `.delete()` returns the deleted row(s); an empty
 * array means either the id doesn't exist or `projects_delete`'s RLS
 * filtered it out (not distinguished, same posture as `renameProject`
 * above) -- both map to 'not_found'.
 */
export async function deleteProject(db: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await db.from('projects').delete().eq('id', id).select('id');
  if (error) {
    const sqlstate = (error as { code?: string }).code ?? '';
    if (sqlstate === '23503') {
      throw new ServiceError('conflict', error.message || `Project ${id} is still referenced by existing reports.`);
    }
    throw mapPgError(error);
  }
  if (!data || data.length === 0) {
    throw new ServiceError('not_found', `Project ${id} not found (or not permitted).`);
  }
}
