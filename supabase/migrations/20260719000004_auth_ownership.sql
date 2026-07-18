-- Weekly Reports Dashboard -- Phase 7a delta: auth, ownership, real RLS,
-- per-report share tokens, the transactional import RPC, and the
-- created_at/updated_at type widening.
--
-- This is the schema half of Phase 7a (Supabase Auth). Phase 7b (the data
-- plane -- db-mapping, reports-service, route handlers, HttpReportsRepository,
-- the localStorage->Supabase import UI, the Share dialog's Enable/Revoke UI,
-- the token-aware present route) is explicitly OUT OF SCOPE here; this
-- migration only lands the SQL surface 7b will consume, verified directly
-- against the database (psql spot-checks + node scripts), not through the
-- app.

-- =============================================================================
-- 0) created_at / updated_at: date -> timestamptz
-- =============================================================================
-- Not a correctness fix for anything shipped so far -- `updatedAt` is only
-- ever *displayed* (fmtDateShort in DashboardScreen/DailyListScreen), and
-- consolidation orders by weekEnd, not updatedAt. It's landed now because
-- 7b's updateReport is fetch -> merge-in-TS -> write-back, which is a lost-
-- update race under concurrent users; the standard fix is optimistic
-- concurrency keyed on updated_at, and that needs sub-day resolution to work
-- at all. Cheap here, expensive to retrofit once 7b's mapping layer exists.
-- TS side is deliberately UNCHANGED in 7a: `createdAt`/`updatedAt` stay
-- `z.string()` (lib/schema/report.ts), `nowDate()` stays yyyy-mm-dd (lib/
-- format.ts) -- a date string is a valid timestamptz input, and
-- `fmtDateShort` keeps working on whatever comes back. FOLLOW-UP (7b): `lib/
-- server/db-mapping.ts` owns read-side normalization (timestamptz -> the
-- string shape the UI expects) and is where optimistic-concurrency checks
-- against `updated_at` should be added to `updateReport`.
-- `using created_at::timestamptz` (a plain cast) would silently depend on
-- the SESSION's timezone setting -- verified: under `set timezone =
-- 'Asia/Tokyo'`, `'2026-06-05'::date::timestamptz` resolves to
-- `2026-06-05 00:00:00+09`, which is `2026-06-04 15:00:00 UTC` -- the date
-- rolls back a full day the moment anything reads it back in UTC (or any
-- other timezone). Supabase defaults every connection to UTC, so this is
-- latent, not live, but it is exactly the bug class CLAUDE.md's "no
-- Date-based timezone math in comparisons, dates are ISO strings" rule
-- exists to prevent, and the whole POINT of these columns staying
-- ISO-string-shaped on the TS side (see the header comment above) is that
-- the stored instant must always mean midnight UTC on that calendar day,
-- unconditionally. `date::timestamp at time zone 'UTC'` (not `::timestamptz`
-- directly) is what actually guarantees that regardless of the
-- session/server timezone.
alter table reports
  alter column created_at type timestamptz using (created_at::timestamp at time zone 'UTC'),
  alter column updated_at type timestamptz using (updated_at::timestamp at time zone 'UTC'),
  alter column created_at set default now(),
  alter column updated_at set default now();

comment on column reports.created_at is
  'Widened from `date` to `timestamptz` in Phase 7a for future optimistic-concurrency support (see migration header). lib/schema/report.ts keeps createdAt as a plain z.string() -- a date or timestamptz string is equally valid input to it.';
comment on column reports.updated_at is
  'Widened from `date` to `timestamptz` in Phase 7a -- see reports.created_at and the migration header comment. 7b''s updateReport should key optimistic-concurrency checks off this column.';

-- =============================================================================
-- 1) Ownership
-- =============================================================================
alter table reports add column owner_id uuid references auth.users (id);
create index reports_owner_id_idx on reports (owner_id);
comment on column reports.owner_id is
  'auth.users id of the report''s owner. NULL = system/unclaimed (admin-editable only). Stamped server-side by lib/server/reports-service.ts (Phase 7b), never trusted from the client.';

-- Admin = raw_app_meta_data.role = 'admin' (app_metadata is embedded in the JWT and
-- NOT user-editable, unlike user_metadata; role changes take effect on token refresh, <= 1h).
create or replace function public.is_admin() returns boolean
language sql stable
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;

comment on function public.is_admin() is
  'True iff the calling JWT''s app_metadata.role = ''admin''. app_metadata is server-set only (auth.admin.updateUserById), unlike user_metadata -- safe to trust inside RLS policies.';

-- Post-review hardening: Supabase's baseline `alter default privileges in
-- schema public grant execute on functions to anon, authenticated,
-- service_role` (roles.sql) grants EXECUTE to every role on every new
-- function in this schema by default -- `revoke ... from public` does NOT
-- touch those, since they are explicit per-role grants, not the PUBLIC
-- pseudo-role. is_admin() reveals nothing sensitive about anyone but the
-- caller's own JWT, so this is defense-in-depth (narrower attack surface),
-- not a live leak the way the auth hook below was -- anon has no
-- legitimate reason to call it (every RLS policy that references it is
-- itself scoped `to authenticated`).
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =============================================================================
-- 2) Real RLS (drop every authenticated_full_access stub)
-- =============================================================================
drop policy if exists authenticated_full_access on reports;
drop policy if exists authenticated_full_access on tasks;
drop policy if exists authenticated_full_access on risks;
drop policy if exists authenticated_full_access on priorities;
drop policy if exists authenticated_full_access on projects;

-- ---- reports ----------------------------------------------------------------
create policy reports_select on reports for select to authenticated using (true);
create policy reports_insert on reports for insert to authenticated
  with check (owner_id = (select auth.uid()) or public.is_admin());
create policy reports_update on reports for update to authenticated
  using     (owner_id = (select auth.uid()) or public.is_admin())
  with check (owner_id = (select auth.uid()) or public.is_admin());  -- also blocks non-admin owner reassignment
create policy reports_delete on reports for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());

-- ---- tasks / risks / priorities (identical trio each, scoped via the parent report) ----
create policy tasks_select on tasks for select to authenticated using (true);
create policy tasks_insert on tasks for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy tasks_update on tasks for update to authenticated
  using (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())))
  with check (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy tasks_delete on tasks for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));

create policy risks_select on risks for select to authenticated using (true);
create policy risks_insert on risks for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy risks_update on risks for update to authenticated
  using (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())))
  with check (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy risks_delete on risks for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));

create policy priorities_select on priorities for select to authenticated using (true);
create policy priorities_insert on priorities for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy priorities_update on priorities for update to authenticated
  using (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())))
  with check (exists (
    select 1 from reports r where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.is_admin())));
create policy priorities_delete on priorities for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.is_admin())));

-- ---- projects: shared reference data -- read+create any authenticated; rename/delete admin-only ----
create policy projects_select on projects for select to authenticated using (true);
create policy projects_insert on projects for insert to authenticated with check (true);
create policy projects_update on projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy projects_delete on projects for delete to authenticated using (public.is_admin());

-- =============================================================================
-- 3) Per-report share tokens (Decision 1 -- see the plan this migration
--    implements: share links use per-report tokens, NOT "require sign-in",
--    because they're sent to the founder and to clients who will never have
--    accounts).
-- =============================================================================
alter table reports add column share_token text unique;
comment on column reports.share_token is
  'Opt-in public share token (NULL by default -- sharing is per-report opt-in, never on by default). Generated server-side only (crypto.randomUUID() or encode(gen_random_bytes(32), ''hex'')) -- never client-supplied. Enable/revoke are owner-or-admin operations, enforced by public.enable_report_share()/revoke_report_share() below (SECURITY DEFINER RPCs; direct column writes are blocked, see the column-privilege revoke below) -- this column + public.get_shared_report() are the 7a schema surface 7b''s Share dialog will call.';

-- Post-review hardening: the column comment above ASSERTS server-generated-
-- only, but nothing enforced it -- any authenticated owner could `PATCH
-- /rest/v1/reports?id=eq.mine {"share_token":"abc"}` directly (their own
-- report's `reports_update` RLS policy permits writing any column,
-- including this one) and hand out a trivially guessable link (verified:
-- "abc" brute-forced against get_shared_report in 60 guesses / 0.2s, no
-- rate limiting). Two layers close this:
--   1) A CHECK requiring real entropy -- a client could still set a
--      HIGH-entropy value by hand, but can no longer set anything trivial.
--   2) Column-level privileges (below) that make share_token genuinely
--      unwritable via direct INSERT/UPDATE for `authenticated` at all --
--      PostgREST enforces column grants, so a direct PATCH/POST touching
--      this column now fails outright, regardless of RLS. The only path
--      left is the SECURITY DEFINER RPCs below, which generate the token
--      server-side themselves.
alter table reports add constraint reports_share_token_format check (
  share_token is null or share_token ~ '^[a-f0-9]{32,}$'
);

revoke insert, update on reports from authenticated;
grant insert (
  id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by,
  summary_narrative, win_stat, win_label, win_narrative,
  touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative,
  created_at, updated_at, project_id, owner_id
) on reports to authenticated;
grant update (
  id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by,
  summary_narrative, win_stat, win_label, win_narrative,
  touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative,
  created_at, updated_at, project_id, owner_id
) on reports to authenticated;
-- `share_token` is deliberately absent from both column lists above --
-- verified: a direct PATCH touching share_token now fails with
-- 42501/"permission denied for table reports" (a grant-level denial,
-- distinct from an RLS denial) even for a report's own owner.

-- SECURITY DEFINER (deliberately, unlike replace_reports/get_shared_report's
-- already-established INVOKER-vs-DEFINER split above): the whole point is
-- to let an owner/admin trigger a share_token WRITE that their own column
-- privileges no longer permit directly. The function re-implements the
-- ownership check by hand (owner_id = auth.uid() OR is_admin()) since
-- SECURITY DEFINER bypasses RLS entirely -- this check is the ONLY thing
-- standing in for it here.
-- `set search_path = ''` (not `= public`) on every SECURITY DEFINER
-- function below, per Supabase's own linter recommendation: an emptied
-- search_path means Postgres can't be tricked into resolving an unqualified
-- relation/function name against a same-named object planted earlier in
-- the path (notably `pg_temp`, which every session searches FIRST,
-- ahead of any explicit schema -- an empty search_path removes that
-- implicit lookup too). Every relation/function reference below is
-- consequently schema-qualified (`public.reports`, `extensions.
-- gen_random_bytes`, ...) -- there is no live exploit for this in a
-- read-mostly, connection-pooled local/Supabase-hosted setup, but it costs
-- nothing and is the recommended posture for every SECURITY DEFINER
-- function, not just the ones with an obvious current risk.
create or replace function public.enable_report_share(p_report_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token text;
begin
  if not exists (
    select 1 from public.reports r
    where r.id = p_report_id and (r.owner_id = (select auth.uid()) or public.is_admin())
  ) then
    raise exception 'Report not found or not permitted' using errcode = '42501';
  end if;

  new_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.reports set share_token = new_token where id = p_report_id;
  return new_token;
end;
$$;

create or replace function public.revoke_report_share(p_report_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.reports r
    where r.id = p_report_id and (r.owner_id = (select auth.uid()) or public.is_admin())
  ) then
    raise exception 'Report not found or not permitted' using errcode = '42501';
  end if;

  update public.reports set share_token = null where id = p_report_id;
end;
$$;

comment on function public.enable_report_share(text) is
  'Owner-or-admin-only. Generates a fresh, high-entropy share_token (32 random bytes, hex) server-side and writes it -- the ONLY path that can set reports.share_token, since direct column writes are revoked above. Returns the new token. Phase 7b''s Share dialog "Enable public link" button calls this.';
comment on function public.revoke_report_share(text) is
  'Owner-or-admin-only. Clears reports.share_token back to NULL. Phase 7b''s Share dialog "Revoke" button calls this.';

revoke all on function public.enable_report_share(text) from public, anon;
grant execute on function public.enable_report_share(text) to authenticated;
revoke all on function public.revoke_report_share(text) from public, anon;
grant execute on function public.revoke_report_share(text) to authenticated;

-- The ONLY anon-reachable read path. Not an anon SELECT policy: an anon
-- policy would need to expose share_token as a filterable column, and report
-- ids like "r1" are guessable -- a SECURITY DEFINER function is the only
-- anon-reachable path, and it can only ever return the single report whose
-- share_token matches the given token. Never accepts an id; never returns a
-- list. A NULL/empty token must return NULL, never a row (guarded explicitly
-- below, not left to rely on SQL's NULL = NULL semantics alone, since a
-- careless argument default could otherwise coax this into matching every
-- share_token IS NULL row).
create or replace function public.get_shared_report(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid text;
  result jsonb;
begin
  if token is null or length(btrim(token)) = 0 then
    return null;
  end if;

  select r.id into rid from public.reports r where r.share_token = token;
  if rid is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', r.id,
    'kind', r.kind,
    'weekStart', r.week_start,
    'weekEnd', r.week_end,
    'date', r.report_date,
    'status', r.status,
    'preparedFor', r.prepared_for,
    'preparedBy', r.prepared_by,
    'summaryNarrative', r.summary_narrative,
    'win', jsonb_build_object('stat', r.win_stat, 'label', r.win_label, 'narrative', r.win_narrative),
    'touchpoints', jsonb_build_object(
      'calls', r.touchpoint_calls, 'emails', r.touchpoint_emails,
      'escalations', r.touchpoint_escalations, 'narrative', r.touchpoints_narrative
    ),
    'createdAt', r.created_at,
    'updatedAt', r.updated_at,
    'projectId', r.project_id,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'client', t.client, 'projectId', t.project_id,
        'task', t.task, 'status', t.status, 'deadline', t.deadline
      ) order by t.position)
      from public.tasks t where t.report_id = r.id
    ), '[]'::jsonb),
    'risks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rk.id, 'client', rk.client, 'projectId', rk.project_id,
        'severity', rk.severity, 'description', rk.description, 'nextStep', rk.next_step
      ) order by rk.position)
      from public.risks rk where rk.report_id = r.id
    ), '[]'::jsonb),
    'priorities', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'text', p.text) order by p.position)
      from public.priorities p where p.report_id = r.id
    ), '[]'::jsonb)
  )
  into result
  from public.reports r
  where r.id = rid;

  return result;
end;
$$;

revoke all on function public.get_shared_report(text) from public;
grant execute on function public.get_shared_report(text) to anon, authenticated;

comment on function public.get_shared_report(text) is
  'The ONLY anon-reachable report read path (Decision 1). Takes a share token, never an id; returns the single matching report (with children in position order) as jsonb, or NULL if the token is null/empty/unmatched. SECURITY DEFINER so it can bypass RLS for the anon role -- there is deliberately no anon SELECT policy on reports/tasks/risks/priorities.';

-- =============================================================================
-- 4) api_tokens (Phase 8 consumes; schema lands here with the rest of the auth domain)
-- =============================================================================
create table api_tokens (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,          -- sha-256 hex; plaintext never stored
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Post-review addition (while the table is still empty, cheapest possible
  -- time to land this): Phase 8's schema-only stub originally had no
  -- expiry/revocation timestamps, meaning "revoke" would have had to be a
  -- DELETE (no audit trail of when/that a token was ever revoked, vs.
  -- simply never created). Both are nullable and unused by anything in
  -- Phase 7 -- Phase 8 designs the actual revoke/expiry UX and validator
  -- logic against them.
  expires_at timestamptz,
  revoked_at timestamptz
);

comment on table api_tokens is
  'Phase 8 MCP server API tokens. No UI or validation reads/writes this table in Phase 7 -- schema lands now to keep the auth domain migration together.';

alter table api_tokens enable row level security;
create policy api_tokens_select on api_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy api_tokens_insert on api_tokens for insert to authenticated with check (user_id = (select auth.uid()));
create policy api_tokens_delete on api_tokens for delete to authenticated using (user_id = (select auth.uid()));
-- No UPDATE policy: tokens are create/revoke only; Phase 8's service-role validator updates last_used_at.

-- Post-review hardening, same rationale as reports.share_token above:
-- `token_hash` is a verifier, never something a client needs to read back
-- (a token's own owner listing their tokens should see id/label/timestamps,
-- never the hash) -- restrict SELECT to the non-secret columns at the grant
-- level so this holds regardless of what a future Phase 8 UI's query
-- happens to select().
revoke select on api_tokens from authenticated;
grant select (id, user_id, label, created_at, last_used_at, expires_at, revoked_at) on api_tokens to authenticated;

-- =============================================================================
-- 5) Transactional write path (7b consumes it; the function lands here)
-- =============================================================================
-- SECURITY INVOKER is the load-bearing property: the function runs as the
-- calling `authenticated` role with the caller's own JWT, so every RLS
-- policy above applies INSIDE the transaction -- this function adds
-- atomicity across a report + its children, never privilege escalation.
--
-- Payload shape (one array element per report) mirrors the SQL row shape
-- (snake_case column names, matching docs/database-schema.md), NOT the
-- camelCase TS domain shape -- 7b's lib/server/db-mapping.ts owns that
-- translation before calling this function:
--   {
--     "id": "r1", "kind": "weekly", "week_start": "2026-06-01", "week_end": "2026-06-05",
--     "report_date": null, "status": "Draft", "prepared_for": "...", "prepared_by": "...",
--     "summary_narrative": "...", "win_stat": "...", "win_label": "...", "win_narrative": "...",
--     "touchpoint_calls": 0, "touchpoint_emails": 0, "touchpoint_escalations": 0,
--     "touchpoints_narrative": "...", "created_at": "...", "updated_at": "...",
--     "project_id": null, "owner_id": null,
--     "tasks": [{"id": "t1", "client": "...", "project_id": null, "task": "...", "status": "...", "deadline": null}],
--     "risks": [{"id": "rk1", "client": "...", "project_id": null, "severity": "...", "description": "...", "next_step": "..."}],
--     "priorities": [{"id": "p1", "text": "..."}]
--   }
-- `share_token` is deliberately NOT part of this payload/function at all --
-- per Decision 1, tokens are generated server-side only and are never part
-- of a bulk import; enabling/revoking a share link is a separate, narrow
-- operation 7b will add (e.g. a dedicated RPC or a plain authenticated
-- UPDATE), not something replace_reports touches.
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
      -- NOTE for 7b (see the `::timestamptz` timezone caveat on the
      -- created_at/updated_at ALTER at the top of this file): a bare
      -- `::timestamptz` cast is only unambiguous for a FULLY-QUALIFIED
      -- ISO-8601 string (explicit `Z`/offset) -- 7b's db-mapping layer
      -- must always send one, never a bare `yyyy-mm-dd` here.
      coalesce((rec ->> 'created_at')::timestamptz, now()),
      coalesce((rec ->> 'updated_at')::timestamptz, now()),
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
      updated_at              = excluded.updated_at,
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
  'Transactional upsert of a report + its tasks/risks/priorities in one round-trip (7b''s CSV import / localStorage->Supabase import call this). SECURITY INVOKER: runs as the calling authenticated role, so every RLS policy above still applies -- this only adds atomicity, never privilege escalation. skip_existing=true skips (and reports) any id already present instead of overwriting it. Returns {"imported": [ids], "skipped": [ids]}.';

-- Post-review hardening (same rationale as is_admin() above): close the
-- default `anon`/PUBLIC execute grant Supabase's baseline default
-- privileges apply to every new function. RLS already blocks an anon call
-- here today (verified: 42501 "new row violates row-level security policy"
-- -- SECURITY INVOKER means it runs with the caller's own, RLS-constrained
-- privileges regardless of table-level GRANTs), so this is defense-in-
-- depth against relying on RLS as the ONLY gate for a function anon has no
-- legitimate reason to call at all.
revoke all on function public.replace_reports(jsonb, boolean) from public, anon;
grant execute on function public.replace_reports(jsonb, boolean) to authenticated;

-- =============================================================================
-- 6) Signup email-domain allowlist (Decision 2) -- enforced server-side via a
--    `before_user_created` Postgres Auth Hook (supabase/config.toml
--    [auth.hook.before_user_created]), verified working on CLI 2.72.7 by
--    directly probing the local Auth API (see PR notes / Phase 7a summary):
--    the hook receives {"user": {..., "email": ...}, "metadata": {...}} and a
--    rejection is `{"error": {"http_code": 400, "message": "..."}}`, which
--    GoTrue turns into an HTTP 400 with that message AND genuinely prevents
--    the auth.users row from being created (confirmed by querying auth.users
--    after a rejected signup attempt). This hook is invoked for BOTH
--    password signup and signInWithOtp-triggered auto-signup (magic link),
--    which is the only signup path this app's UI actually uses.
-- =============================================================================
create table public.allowed_signup_domains (
  domain text primary key
);

comment on table public.allowed_signup_domains is
  'Email-domain allowlist enforced by public.before_user_created_hook (wired via supabase/config.toml [auth.hook.before_user_created]). TO ADD A DOMAIN: insert into public.allowed_signup_domains (domain) values (''example.com'') (lowercase, no leading @) -- either directly in a follow-up migration (production) or via psql/Studio locally. Removing a row closes signup for that domain immediately, no redeploy needed. Editing this table is NOT exposed to the app (no insert/update/delete RLS policy for any client role) -- it is an admin/migration-only operation.';

alter table public.allowed_signup_domains enable row level security;
create policy allowed_signup_domains_select on public.allowed_signup_domains for select to authenticated using (true);
-- No insert/update/delete policy for anon/authenticated -- see table comment.

insert into public.allowed_signup_domains (domain) values
  ('arcytex.com'),
  ('foundationfirst.com'),
  ('foundationfirst.test');  -- the local seed users' domain (dev@/member@foundationfirst.test) -- needed so `supabase db reset` + the login E2E keep working.

create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text;
  email_domain text;
begin
  new_email := lower(coalesce(event -> 'user' ->> 'email', ''));

  if new_email = '' or position('@' in new_email) = 0 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'A valid email address is required.'
    ));
  end if;

  email_domain := split_part(new_email, '@', 2);

  if not exists (select 1 from public.allowed_signup_domains d where d.domain = email_domain) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Sign-up is restricted to Foundation First Marketing and Arcytex email addresses. Contact an admin if you believe this is a mistake.'
    ));
  end if;

  return jsonb_build_object();
end;
$$;

comment on function public.before_user_created_hook(jsonb) is
  'Wired as the `before_user_created` Postgres Auth Hook (supabase/config.toml). Rejects any signup (password or magic-link) whose email domain is not in public.allowed_signup_domains. Enforced server-side -- cannot be bypassed by a client that skips its own UI checks. EXECUTE is intentionally NOT granted to anon/authenticated (see the revoke below) -- calling it directly via PostgREST (`POST /rest/v1/rpc/before_user_created_hook`) rather than through the real signup/OTP flow would turn it into an unauthenticated oracle for the entire domain allowlist, with no rate limiting.';

-- CRITICAL, verified-necessary (do not "simplify" to `revoke ... from
-- public` alone): Supabase's baseline `alter default privileges in schema
-- public grant execute on functions to anon, authenticated, service_role`
-- (roles.sql) grants EXECUTE to anon/authenticated/service_role on EVERY
-- new function in this schema by default, as an explicit per-role grant --
-- `revoke all ... from public` does NOT touch those (PUBLIC is a separate
-- pseudo-role from `anon`/`authenticated`). Proven exploitable before this
-- fix: `curl -X POST .../rest/v1/rpc/before_user_created_hook -d
-- '{"event":{"user":{"email":"x@gmail.com"}}}'` returned the function's
-- real rejection message to a fully anonymous, unauthenticated caller --
-- i.e. anyone could enumerate the entire allowlist without ever attempting
-- a real signup (no rate limit, no audit trail). `anon`/`authenticated`
-- must be named explicitly here, every time a function in this schema is
-- meant to be reachable by ONLY a specific internal caller
-- (`supabase_auth_admin`, in this case) -- verify with `pg_proc.proacl`,
-- never by reading the `revoke` statement's intent alone.
revoke all on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.allowed_signup_domains to supabase_auth_admin;
