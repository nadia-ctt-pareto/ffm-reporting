-- Weekly Reports Dashboard -- Phase 7b delta: two review findings against
-- the (uncommitted) M1+M2 data-plane work, both closed at the SQL layer
-- because the API layer alone cannot close either one.
--
-- =============================================================================
-- 1) BLOCKER -- reports.share_token is readable by every authenticated user
-- =============================================================================
-- `reports_select` (20260719000004_auth_ownership.sql) is `using (true)`
-- with NO column restriction. `lib/server/reports-service.ts`'s
-- `reportsQuery` selected `'*'`, so `GET /api/reports` returned every
-- report's `share_token` -- including reports the caller doesn't own -- to
-- every signed-in user. Any authenticated user (e.g. `member@`) could
-- therefore mint a fully-working ANONYMOUS share link
-- (`/reports/<id>/present?t=<token>`) for a report they don't own, without
-- ever calling `enable_report_share()` (the SECURITY DEFINER RPC whose
-- entire point is that MINTING a share link is owner-or-admin-only).
-- Possession of the token, not the ability to mint it, is what actually
-- grants anonymous access -- so this is authenticated-read escalating
-- straight to anonymous-world-read, not authenticated-read to
-- authenticated-read.
--
-- Fixing `app/api/reports/route.ts` alone is NOT sufficient: the same
-- authenticated caller can bypass this app's API entirely and hit
-- PostgREST directly with the anon key + their own JWT --
-- `select=id,share_token` (or a bare `select=*`) -- since `reports_select`
-- has no column-level restriction of its own. Two layers close it, exactly
-- mirroring the `api_tokens.token_hash` column-grant precedent already in
-- 20260719000004_auth_ownership.sql (lines 388-389):
--
--   1) Column-level grant: `authenticated` may SELECT every `reports`
--      column EXCEPT `share_token`. Postgres treats `SELECT *` as
--      equivalent to an explicit column list at the privilege-check layer,
--      so a query naming `share_token` (explicitly, or via `*`) now fails
--      outright with 42501/"permission denied for table reports",
--      regardless of RLS -- even for that report's own owner. (This is why
--      `lib/server/reports-service.ts`'s `reportsQuery` must switch from
--      `select('*', ...)` to an explicit column list in the same commit
--      that lands this migration -- `*` would otherwise start failing the
--      moment this grant lands.)
--   2) The ONLY read path left for `share_token` is a NEW owner-or-admin-
--      gated SECURITY DEFINER RPC, `get_report_share_token(report_id)` --
--      hand-rolls the identical ownership check `enable_report_share`/
--      `revoke_report_share` already use (SECURITY DEFINER bypasses RLS
--      entirely, so the check has to be re-implemented here too; see that
--      migration's own comment on why). Phase 7b's new
--      `GET /api/reports/[id]/share` route handler calls this -- the
--      caller Milestone M3's ShareDialog will use to show/copy the
--      already-enabled link without re-minting it.
--
-- Verified as the correct scope: `tasks`/`risks`/`priorities`/`projects`
-- carry no equivalent secret column, so only `reports` needs a grant
-- change.

revoke select on reports from authenticated;
grant select (
  id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by,
  summary_narrative, win_stat, win_label, win_narrative,
  touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative,
  created_at, updated_at, project_id, owner_id
) on reports to authenticated;
-- `share_token` is deliberately absent above -- verified: `curl
-- "$SUPABASE_URL/rest/v1/reports?select=id,share_token" -H "apikey: $ANON"
-- -H "Authorization: Bearer $MEMBER_JWT"` now returns 42501/"permission
-- denied for table reports" instead of every report's token.

create or replace function public.get_report_share_token(p_report_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if not exists (
    select 1 from public.reports r
    where r.id = p_report_id and (r.owner_id = (select auth.uid()) or public.is_admin())
  ) then
    raise exception 'Report not found or not permitted' using errcode = '42501';
  end if;

  select r.share_token into result from public.reports r where r.id = p_report_id;
  return result;
end;
$$;

comment on function public.get_report_share_token(text) is
  'Owner-or-admin-only. Returns the report''s current share_token, or NULL if sharing is not enabled. The ONLY read path for share_token now that direct SELECT on that column is grant-revoked above (see the revoke/grant pair immediately preceding this function). Phase 7b''s GET /api/reports/[id]/share calls this -- Milestone M3''s ShareDialog is the intended caller.';

revoke all on function public.get_report_share_token(text) from public, anon;
grant execute on function public.get_report_share_token(text) to authenticated;
-- `anon` deliberately excluded, same rationale as enable_report_share/
-- revoke_report_share: anon has no account to own a report with, so it has
-- no legitimate reason to call this at all.

-- =============================================================================
-- 2) SHOULD-FIX -- POST /api/reports let a client forge reports.updated_at
-- =============================================================================
-- `AnyReportInputSchema` includes `updatedAt`, `reportToRow` forwards it
-- (lib/server/db-mapping.ts), and `replace_reports` used to take it
-- straight from the payload on BOTH the insert branch
-- (`coalesce((rec->>'updated_at')::timestamptz, now())`) and the
-- on-conflict-update branch (`updated_at = excluded.updated_at`). Two
-- consequences: (a) a client could backdate/forward-date its own reports'
-- "Last Updated" -- the only audit signal the UI shows -- via a plain
-- `POST /api/reports`; (b) it weakened `updateReport`'s `expectedUpdatedAt`
-- CAS check (lib/server/reports-service.ts, added for Phase 8's
-- `update_report` MCP tool): a client that pins `updated_at` constant
-- across writes through the POST path makes that CAS permanently pass,
-- defeating the concurrency guard it exists to provide.
--
-- Fix: `replace_reports` now stamps `updated_at = now()` itself, on BOTH
-- branches, ignoring whatever the payload said -- the transactional write
-- path is the single place every caller (CSV import, the localStorage->
-- Supabase import, Phase 8's `create_report`/`update_report` MCP tools)
-- goes through, so fixing it here closes the gap for every current AND
-- future caller, not just today's TS callers. `created_at` is
-- DELIBERATELY left payload-controlled on insert (unchanged) -- a
-- legitimate import (CSV, localStorage->Supabase) needs to preserve a
-- record's true original creation date, and creation-date forgery was not
-- the audit/CAS-weakening vector the review flagged (`updated_at` was).
create or replace function public.replace_reports(payload jsonb, skip_existing boolean default false)
returns jsonb
language plpgsql
security invoker
as $$
declare
  imported text[] := array[]::text[];
  skipped text[] := array[]::text[];
  rec jsonb;
  rid text;
begin
  for rec in select * from jsonb_array_elements(payload)
  loop
    rid := rec ->> 'id';

    if skip_existing and exists (select 1 from reports where id = rid) then
      skipped := array_append(skipped, rid);
      continue;
    end if;

    insert into reports (
      id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by,
      summary_narrative, win_stat, win_label, win_narrative,
      touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative,
      created_at, updated_at, project_id, owner_id
    ) values (
      rid,
      coalesce(rec ->> 'kind', 'weekly'),
      nullif(rec ->> 'week_start', '')::date,
      nullif(rec ->> 'week_end', '')::date,
      nullif(rec ->> 'report_date', '')::date,
      rec ->> 'status',
      coalesce(rec ->> 'prepared_for', ''),
      coalesce(rec ->> 'prepared_by', ''),
      coalesce(rec ->> 'summary_narrative', ''),
      coalesce(rec ->> 'win_stat', ''),
      coalesce(rec ->> 'win_label', ''),
      coalesce(rec ->> 'win_narrative', ''),
      coalesce((rec ->> 'touchpoint_calls')::int, 0),
      coalesce((rec ->> 'touchpoint_emails')::int, 0),
      coalesce((rec ->> 'touchpoint_escalations')::int, 0),
      coalesce(rec ->> 'touchpoints_narrative', ''),
      -- NOTE (unchanged from 20260719000004_auth_ownership.sql): a bare
      -- `::timestamptz` cast is only unambiguous for a FULLY-QUALIFIED
      -- ISO-8601 string (explicit `Z`/offset) -- lib/server/db-mapping.ts's
      -- `toUtcInstant` always sends one, never a bare `yyyy-mm-dd` here.
      coalesce((rec ->> 'created_at')::timestamptz, now()),
      -- `updated_at` is server-stamped below (SECTION 2 fix) -- the
      -- payload's own `updated_at` is intentionally never read here.
      now(),
      rec ->> 'project_id',
      coalesce((rec ->> 'owner_id')::uuid, (select auth.uid()))
    )
    on conflict (id) do update set
      kind                    = excluded.kind,
      week_start              = excluded.week_start,
      week_end                = excluded.week_end,
      report_date             = excluded.report_date,
      status                  = excluded.status,
      prepared_for            = excluded.prepared_for,
      prepared_by             = excluded.prepared_by,
      summary_narrative       = excluded.summary_narrative,
      win_stat                = excluded.win_stat,
      win_label               = excluded.win_label,
      win_narrative           = excluded.win_narrative,
      touchpoint_calls        = excluded.touchpoint_calls,
      touchpoint_emails       = excluded.touchpoint_emails,
      touchpoint_escalations  = excluded.touchpoint_escalations,
      touchpoints_narrative   = excluded.touchpoints_narrative,
      -- Server-stamped, not `excluded.updated_at` (SECTION 2 fix) -- see
      -- the header note above.
      updated_at              = now(),
      project_id              = excluded.project_id
      -- owner_id intentionally NOT overwritten on conflict -- preserves the
      -- existing row's owner_id, per the plan this migration implements.
      -- share_token is untouched here for the same reason (see header note).
    ;

    delete from tasks where report_id = rid;
    delete from risks where report_id = rid;
    delete from priorities where report_id = rid;

    insert into tasks (id, report_id, client, project_id, task, status, deadline, position)
    select
      t.val ->> 'id', rid, t.val ->> 'client', t.val ->> 'project_id', t.val ->> 'task', t.val ->> 'status',
      nullif(t.val ->> 'deadline', '')::date, (t.ord - 1)::int
    from jsonb_array_elements(coalesce(rec -> 'tasks', '[]'::jsonb)) with ordinality as t(val, ord);

    insert into risks (id, report_id, client, project_id, severity, description, next_step, position)
    select
      r.val ->> 'id', rid, r.val ->> 'client', r.val ->> 'project_id', r.val ->> 'severity',
      r.val ->> 'description', coalesce(r.val ->> 'next_step', ''), (r.ord - 1)::int
    from jsonb_array_elements(coalesce(rec -> 'risks', '[]'::jsonb)) with ordinality as r(val, ord);

    insert into priorities (id, report_id, text, position)
    select
      p.val ->> 'id', rid, p.val ->> 'text', (p.ord - 1)::int
    from jsonb_array_elements(coalesce(rec -> 'priorities', '[]'::jsonb)) with ordinality as p(val, ord);

    imported := array_append(imported, rid);
  end loop;

  return jsonb_build_object('imported', to_jsonb(imported), 'skipped', to_jsonb(skipped));
end;
$$;

comment on function public.replace_reports(jsonb, boolean) is
  'Transactional upsert of a report + its tasks/risks/priorities in one round-trip (7b''s CSV import / localStorage->Supabase import call this). SECURITY INVOKER: runs as the calling authenticated role, so every RLS policy above still applies -- this only adds atomicity, never privilege escalation. skip_existing=true skips (and reports) any id already present instead of overwriting it. updated_at is ALWAYS server-stamped to now() (post-review hardening, this migration) -- a client-supplied updated_at in the payload is ignored on both insert and conflict-update, closing an audit-forgery / optimistic-concurrency-CAS-defeat gap. Returns {"imported": [ids], "skipped": [ids]}.';

-- Grants unchanged from 20260719000004_auth_ownership.sql (CREATE OR
-- REPLACE preserves existing privileges) -- restated here only so this
-- file is self-checkable without cross-referencing the prior migration:
-- `authenticated` only, RLS (SECURITY INVOKER) is the real gate.
