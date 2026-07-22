-- Weekly Reports Dashboard -- WP3 delta: THE ACCESS FLIP.
--
-- Status: WRITTEN AND VERIFIED LIVE against a local Supabase stack
-- (`supabase start` + `supabase db reset`, then
-- `npx tsx scripts/verify-access-matrix.ts` -- 32/32 checks passed,
-- covering every cell of the locked permission matrix, the org-read MCP
-- scope end to end, and the per-owner daily-uniqueness index). See
-- docs/database-schema.md's "Scoped access (WP3)" section for the full
-- results. NOT applied to any hosted/production project -- that remains
-- the user's own call, same as every migration since
-- 20260725000014_task_completed_at.sql.
--
-- =============================================================================
-- WHAT CHANGES, IN ONE SENTENCE
-- =============================================================================
-- `reports_select`/`tasks_select`/`risks_select`/`priorities_select` move
-- from "every authenticated user reads every row" (`using (true)`) to
-- "the report's own owner, or anyone at pm-or-above, or a bearer token
-- explicitly minted with the org-read scope" -- and every WRITE policy on
-- every table (`reports`/`tasks`/`risks`/`priorities`) drops its `is_admin()`
-- branch entirely: from this migration forward, ONLY a row's owner may
-- insert/update/delete it. There is no "pm/admin can edit anyone's report"
-- branch anywhere below -- see the locked permission matrix this migration
-- implements, restated here:
--
--   |                | read          | edit                | delete |
--   |----------------|---------------|---------------------|--------|
--   | creator (owner)| yes           | yes                 | yes    |
--   | assignee       | yes (own task)| yes (own task, NARROW)| no   |
--   | pm             | ALL           | only own/assigned   | ALL    |
--   | admin          | ALL           | only own/assigned   | ALL    |
--   | other member   | no            | no                  | no     |
--
-- **TRIPWIRE (also recorded in CLAUDE.md -- read that copy too):** this
-- migration adds NO `created_by` column anywhere. "The report's creator can
-- edit it" is expressed here as `owner_id = auth.uid()` -- sound ONLY
-- because every task-creation path in this codebase writes a task into a
-- report the caller already owns (the wizard, the `/tasks` Add Task dialog,
-- CSV import, `create_report`/`update_report` MCP tools -- none of them let
-- caller A add a task to caller B's report). The day that stops being true
-- (a shared/multi-author report, a "add a task to someone else's report"
-- feature), a task's creator and its parent report's owner are no longer
-- provably the same person, and this migration's `tasks_insert`/`_update`/
-- `_delete` policies (which key ONLY off the parent report's `owner_id`)
-- would silently let the WRONG person edit a task they didn't create. A
-- real `created_by` column on `tasks` becomes mandatory at that point; this
-- migration explicitly does not build it preemptively.
--
-- =============================================================================
-- Ownerless rows (owner_id stays NULLABLE)
-- =============================================================================
-- `reports.owner_id` was already nullable (supabase/migrations/
-- 20260719000004_auth_ownership.sql -- the generated seed inserts before any
-- auth user exists, so a seeded row's owner_id is NULL). Under the new
-- `reports_select`, a NULL-owner row matches NEITHER `owner_id = auth.uid()`
-- (NULL = anything is NULL, never true, per SQL's three-valued logic) NOR
-- any assignee arm on the child tables -- it's visible ONLY to pm-or-above
-- (or an org-read token) and editable by NOBODY (every write policy's
-- `owner_id = auth.uid()` has the identical NULL-never-matches property).
-- Production has zero reports today, so there is nothing to migrate/fix for
-- this -- noted here so a future reviewer doesn't mistake it for an
-- oversight.

-- =============================================================================
-- 1) public.token_has_org_read(): the MCP org-read-scope predicate. Defined
--    FIRST -- section 4 (reports/tasks/risks/priorities select policies)
--    references it, and Postgres requires a function referenced by a
--    policy to already exist at CREATE POLICY time.
-- =============================================================================
-- Reads a TOP-LEVEL `org_read` JWT claim (NOT nested under `app_metadata`),
-- deliberately: `lib/server/mcp-auth.ts`'s `mintMcpJwt` sets this claim only
-- for a bridged MCP session whose underlying `api_tokens` row has
-- `org_read = true` (an admin-only flag at token-creation time, enforced by
-- `api_tokens_insert`'s own `with check` below) -- it is NEVER present on a
-- real web-cookie session JWT (Supabase Auth's own token minting has no
-- concept of this claim, and nothing in this codebase's auth flow ever adds
-- one to a normal sign-in), and it is issued by THIS APP'S OWN JWT signer
-- (lib/server/mcp-auth.ts), not by anything a client could otherwise forge
-- into their own session. Living outside `app_metadata` is what keeps this
-- claim fully ISOLATED from `is_admin()`/`has_role_at_least()` -- an
-- org-read token can broaden what it can SELECT, but can never make
-- `is_admin()`/`has_role_at_least('pm')` true, so it can never touch a
-- write policy (none of which reference this function at all).
create or replace function public.token_has_org_read() returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'org_read')::boolean, false)
$$;

comment on function public.token_has_org_read() is
  'True iff the calling JWT carries a top-level org_read claim set to true -- ONLY ever true for an MCP bearer-token session bridged by lib/server/mcp-auth.ts''s mintMcpJwt, for a token created with the admin-only org-read scope (api_tokens.org_read). Absent (-> false) on every real web-cookie session JWT. Read-only widening: no write policy anywhere references this function, and it cannot make is_admin()/has_role_at_least() true (it lives outside app_metadata) -- an org-read token still writes strictly as its own owner, same as any other token.';

revoke all on function public.token_has_org_read() from public, anon;
grant execute on function public.token_has_org_read() to authenticated;

-- =============================================================================
-- 2) api_tokens.org_read -- the admin-only opt-in scope column.
-- =============================================================================
alter table api_tokens add column org_read boolean not null default false;

comment on column api_tokens.org_read is
  'WP3: opt-in MCP scope -- when true, this token''s bridged JWT carries a top-level org_read claim (lib/server/mcp-auth.ts''s mintMcpJwt), which public.token_has_org_read() (section 1) honours as an EXTRA read-only arm on reports/tasks/risks/priorities select. Default false (every existing/most new tokens stay scoped to their owner''s own reports, matching a plain member''s own read access). Settable ONLY at creation time by an admin -- see api_tokens_insert''s with check below; there is no UPDATE path for this column (api_tokens has no UPDATE policy at all, unchanged from Phase 7a -- "tokens are create/revoke only").';

drop policy if exists api_tokens_insert on api_tokens;
-- Admin-only gate on org_read=true, enforced at the ROW-LEVEL SECURITY
-- layer (not just app/api/tokens/route.ts's own request handling) so a
-- non-admin's raw PostgREST insert with `{"org_read": true}` is ALSO
-- rejected, not just this app's own UI -- same "don't rely on a single
-- layer" posture as every other admin-gated write in this schema
-- (projects_update's column grant, Phase 8c). A non-org-read insert
-- (org_read omitted/false) is unaffected -- every member can still create
-- their own plain, owner-scoped token exactly as before.
create policy api_tokens_insert on api_tokens for insert to authenticated
  with check (user_id = (select auth.uid()) and (org_read = false or public.has_role_at_least('admin')));

comment on policy api_tokens_insert on api_tokens is
  'WP3: org_read=true is admin-only (public.has_role_at_least(''admin'')) -- a non-admin''s insert with org_read:true is rejected by RLS (42501), not just hidden by the Settings UI checkbox. org_read=false (the default) is unrestricted, same as every prior token creation.';

-- =============================================================================
-- 3) verify_api_token: widened to also return org_read, so lib/server/
--    mcp-auth.ts can mint the org_read JWT claim (section 1) at bridge time.
--    Return type changes (uuid -> jsonb), so this DROPs the old function
--    first (`create or replace` cannot change a function's return type) --
--    every other property (BARE-anon-client-only caller, atomic UPDATE...
--    RETURNING closing the same revoked/expired TOCTOU window, hashing via
--    extensions.digest byte-for-byte matching lib/server/mcp-auth.ts's
--    hashApiTokenForStorage) is UNCHANGED from
--    supabase/migrations/20260721000007_mcp_tokens.sql's original.
-- =============================================================================
drop function if exists public.verify_api_token(text);

create or replace function public.verify_api_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_user_id uuid;
  v_org_read boolean;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.api_tokens
  set last_used_at = now()
  where token_hash = v_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning user_id, org_read into v_user_id, v_org_read;

  if v_user_id is null then
    return null;
  end if;

  return jsonb_build_object('user_id', v_user_id, 'org_read', coalesce(v_org_read, false));
end;
$$;

comment on function public.verify_api_token(text) is
  'WP3: widened from returning bare uuid to jsonb {"user_id":..., "org_read":...} so the MCP auth bridge can mint the org_read JWT claim (section 1). Same hash/lookup/revoked/expired/last_used_at semantics as the original (supabase/migrations/20260721000007_mcp_tokens.sql) -- returns NULL for any failure (missing, garbage, revoked, expired), never distinguishing why.';

revoke all on function public.verify_api_token(text) from public, anon, authenticated;
grant execute on function public.verify_api_token(text) to anon;

-- =============================================================================
-- 4) reports / tasks / risks / priorities RLS -- the actual access flip.
-- =============================================================================

-- ---- reports ----------------------------------------------------------------
drop policy if exists reports_select on reports;
drop policy if exists reports_insert on reports;
drop policy if exists reports_update on reports;
drop policy if exists reports_delete on reports;

create policy reports_select on reports for select to authenticated using (
  owner_id = (select auth.uid())
  or public.has_role_at_least('pm')
  or public.token_has_org_read()
);

-- Admin branch REMOVED: nobody may create a report claiming someone else as
-- its owner, not even an admin -- there was never a legitimate reason to
-- (every create path stamps the CALLER as owner; `replace_reports`' own
-- `coalesce(owner_id, auth.uid())` default already assumes this).
create policy reports_insert on reports for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Admin branch REMOVED per the matrix ("pm/admin edit only own/assigned") --
-- this is the actual flip: under the PRIOR migration an admin could PATCH
-- anyone's report; under this one, only a report's own owner can, full stop.
-- `with check` still blocks a non-admin (now: ANY caller) from reassigning
-- `owner_id` to someone else on update, same as before.
create policy reports_update on reports for update to authenticated
  using     (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Delete stays broader than edit, per the matrix ("pm/admin: delete ALL") --
-- has_role_at_least('pm') replaces the old is_admin() branch, widening
-- delete authority from admin-only to pm-or-above; ownership alone still
-- suffices too.
create policy reports_delete on reports for delete to authenticated
  using (owner_id = (select auth.uid()) or public.has_role_at_least('pm'));

comment on policy reports_select on reports is
  'WP3: owner, pm+, or an org-read-scoped MCP token -- replaces the old using(true) org-wide read.';
comment on policy reports_update on reports is
  'WP3: owner ONLY -- the is_admin() branch from 20260719000004_auth_ownership.sql is gone. pm/admin can no longer edit a report they do not own; see the locked permission matrix in this migration''s header comment.';
comment on policy reports_delete on reports is
  'WP3: owner or pm+ (was owner or admin) -- delete authority widened from admin-only to pm-or-above, per the locked permission matrix.';

-- ---- tasks -- select gains the assignee arm (a task's own assignee can see
--    it even on a report they don't own/can't otherwise read); write stays
--    parent-report-OWNER-only, with the admin branch removed. Assignee
--    writes NEVER go through this direct UPDATE policy -- only through
--    `update_assigned_task()` (section 6), a narrow, owner-or-assignee
--    SECURITY DEFINER RPC that can only ever touch status/deadline/
--    completed_at, never `task`/`client`/`assignee_id`/`project_id`. ------
drop policy if exists tasks_select on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_update on tasks;
drop policy if exists tasks_delete on tasks;

create policy tasks_select on tasks for select to authenticated using (
  exists (
    select 1 from reports r
    where r.id = report_id
      and (r.owner_id = (select auth.uid()) or public.has_role_at_least('pm') or public.token_has_org_read())
  )
  or exists (
    select 1 from team_members tm
    where tm.id = tasks.assignee_id and tm.user_id = (select auth.uid())
  )
);
create policy tasks_insert on tasks for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));
create policy tasks_update on tasks for update to authenticated
  using (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())));
create policy tasks_delete on tasks for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));

comment on policy tasks_select on tasks is
  'WP3: parent report owner/pm+/org-read-token, OR the task''s own assignee (via team_members.user_id) -- an assignee can see a task on a report they do not otherwise have access to, but NOTHING else about that report (no sibling tasks, no risks/priorities/narrative -- see list_assigned_tasks(), section 5).';
comment on policy tasks_update on tasks is
  'WP3: parent-report OWNER only (admin branch removed) -- an assignee''s status/deadline/completed_at edits go ONLY through update_assigned_task() (section 6), never this direct UPDATE policy.';

-- ---- risks / priorities -- no assignee concept (nothing assigns a risk or
--    a priority to a person), so these simply follow the parent report:
--    select = report visible (owner/pm+/org-read-token); write = report
--    OWNER only. ------------------------------------------------------------
drop policy if exists risks_select on risks;
drop policy if exists risks_insert on risks;
drop policy if exists risks_update on risks;
drop policy if exists risks_delete on risks;

create policy risks_select on risks for select to authenticated using (exists (
  select 1 from reports r
  where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.has_role_at_least('pm') or public.token_has_org_read())
));
create policy risks_insert on risks for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));
create policy risks_update on risks for update to authenticated
  using (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())));
create policy risks_delete on risks for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));

drop policy if exists priorities_select on priorities;
drop policy if exists priorities_insert on priorities;
drop policy if exists priorities_update on priorities;
drop policy if exists priorities_delete on priorities;

create policy priorities_select on priorities for select to authenticated using (exists (
  select 1 from reports r
  where r.id = report_id
    and (r.owner_id = (select auth.uid()) or public.has_role_at_least('pm') or public.token_has_org_read())
));
create policy priorities_insert on priorities for insert to authenticated with check (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));
create policy priorities_update on priorities for update to authenticated
  using (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())));
create policy priorities_delete on priorities for delete to authenticated using (exists (
  select 1 from reports r where r.id = report_id and r.owner_id = (select auth.uid())
));

-- `projects`/`team_members`/`api_tokens`/`ai_keys` RLS is otherwise
-- UNTOUCHED by this migration -- project rename/delete stay admin-only
-- (Phase 8c), the team directory stays admin-write (WP1), tokens stay
-- create/revoke-own-only (Phase 8a) except for the one org_read guard added
-- above, and ai_keys stays owner-only-no-admin-branch (Phase 7c). None of
-- those tables are otherwise part of the read/write scoping this package
-- changes.

-- =============================================================================
-- 5) One-daily-per-day-PER-PERSON: the uniqueness index now also partitions
--    by owner_id, not just project bucket. Rationale: under the OLD
--    org-wide-read/admin-edit world, "one daily per day per project bucket"
--    (supabase/migrations/20260718000003_projects.sql) was already scoped
--    to the house-vs-project distinction, but every daily in a bucket was
--    effectively "the team's" daily -- there was one shared truth per
--    bucket per day. Under scoped ownership, TWO DIFFERENT PEOPLE each
--    filing their own house daily for the same calendar day is now a
--    legitimate, expected shape (PM A's Tuesday and PM B's Tuesday are two
--    different people's status updates, not a duplicate) -- so the
--    uniqueness key gains `owner_id`. `coalesce(owner_id::text, '')` folds
--    every NULL-owner (ownerless/legacy) row into the SAME bucket key --
--    mirroring `coalesce(project_id, '')`'s identical purpose immediately
--    beside it (a plain `(owner_id, project_id, report_date)` unique index
--    would treat every NULL as DISTINCT, per Postgres's own NULL-uniqueness
--    semantics, silently failing to enforce the constraint for any
--    ownerless row).
--
--    Index name is kept EXACTLY `reports_one_daily_per_day` -- `curatedMessage`
--    (lib/server/reports-service.ts) pattern-matches this literal name in
--    the raw Postgres conflict-error text to choose the curated "A daily
--    report for this date already exists." copy; renaming it would silently
--    downgrade that to the generic "changed by someone else" conflict
--    message.
-- =============================================================================
drop index if exists reports_one_daily_per_day;
create unique index reports_one_daily_per_day
  on reports (coalesce(owner_id::text, ''), coalesce(project_id, ''), report_date)
  where kind = 'daily';

comment on index reports_one_daily_per_day is
  'WP3: one daily report per (owner, project bucket, calendar day) -- widened from (project bucket, day) alone so two different owners can each file their own house/project daily for the same date without colliding. NULL owner_id folds to '''' via coalesce, same treatment project_id already got. Name is a load-bearing string -- see lib/server/reports-service.ts''s curatedMessage.';

-- =============================================================================
-- 6) list_assigned_tasks(): the CALLER's own assigned tasks, joined with
--    BOUNDED parent-report context only -- id/client/projectId/task/status/
--    deadline/completedAt/assigneeId/createdAt (the task itself), plus
--    reportId/reportKind/weekStart/weekEnd/date/preparedFor (just enough to
--    orient the caller -- "which report, which period, prepared for whom")
--    and the owner's team-directory name when linkable. Deliberately NEVER
--    returns sibling tasks, risks, priorities, or the report's own
--    narrative fields -- that is the entire trust boundary that makes "an
--    assignee can see THEIR task" safe without also handing them the whole
--    report they don't otherwise have access to. Re-derives the caller's
--    own identity from auth.uid() every call (never trusts a parameter --
--    this function takes NONE) via the team_members.user_id join, mirroring
--    tasks_select's own assignee arm (section 4).
-- =============================================================================
create or replace function public.list_assigned_tasks() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  result jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'client', t.client,
    'projectId', t.project_id,
    'task', t.task,
    'status', t.status,
    'deadline', t.deadline,
    'completedAt', t.completed_at,
    'assigneeId', t.assignee_id,
    'createdAt', t.created_at,
    'reportId', r.id,
    'reportKind', r.kind,
    'weekStart', r.week_start,
    'weekEnd', r.week_end,
    'date', r.report_date,
    'preparedFor', r.prepared_for,
    'ownerName', owner.name
  ) order by r.week_end desc nulls last, r.report_date desc nulls last, t.id), '[]'::jsonb)
  into result
  from public.tasks t
  join public.team_members tm on tm.id = t.assignee_id
  join public.reports r on r.id = t.report_id
  left join public.team_members owner on owner.user_id = r.owner_id
  where tm.user_id = v_uid;

  return result;
end;
$$;

comment on function public.list_assigned_tasks() is
  'WP3: the caller''s own assigned tasks, joined with BOUNDED parent-report context ONLY (see this migration''s section 6 header comment) -- never sibling tasks/risks/priorities/narrative. Re-derives the caller''s membership via team_members.user_id = auth.uid() every call; takes no parameters, so there is nothing for a caller to spoof. Returns [] (never an error) for a caller with no linked team_members row or no assigned tasks. lib/server/reports-service.ts''s listAssignedTasks() is the sole TS caller.';

revoke all on function public.list_assigned_tasks() from public, anon;
grant execute on function public.list_assigned_tasks() to authenticated;

-- =============================================================================
-- 7) update_assigned_task(): owner-OR-assignee, but NARROW -- only status/
--    deadline/completed_at are writable through this path, never task/
--    client/assignee_id/project_id (the identity/dedupe fields other
--    people's report chains and this codebase's own client-string dedupe
--    depend on -- see CLAUDE.md's "Migrations discipline" and
--    lib/report-utils.ts's sameProjectBucket). Bumps the parent report's
--    updated_at = now() so this write is visible to the SAME optimistic-
--    concurrency story `replace_reports`/`updateReport` already established
--    (a subsequent GET/list sees a fresh updatedAt). A null argument means
--    "leave this field alone" (NOT "clear it") -- an empty string ('')
--    argument for deadline/completed_at DOES clear it (nullif('', '') ->
--    NULL), matching this codebase's existing '' <-> NULL convention for
--    those two columns everywhere else.
-- =============================================================================
create or replace function public.update_assigned_task(
  p_task_id text,
  p_status text,
  p_deadline text,
  p_completed_at text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_assignee_id text;
  v_now timestamptz;
  v_row public.tasks%rowtype;
  v_report public.reports%rowtype;
  v_owner_name text;
begin
  select r.owner_id, t.assignee_id
  into v_owner_id, v_assignee_id
  from public.tasks t
  join public.reports r on r.id = t.report_id
  where t.id = p_task_id;

  if not found then
    raise exception 'Task not found or not permitted' using errcode = '42501';
  end if;

  if v_uid is null or not (
    v_owner_id = v_uid
    or exists (select 1 from public.team_members tm where tm.id = v_assignee_id and tm.user_id = v_uid)
  ) then
    raise exception 'Task not found or not permitted' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('Complete', 'In Progress', 'Blocked') then
    raise exception 'status must be one of Complete, In Progress, Blocked' using errcode = '22023';
  end if;

  v_now := now();

  update public.tasks
  set
    status = coalesce(p_status, status),
    deadline = case when p_deadline is not null then nullif(p_deadline, '')::date else deadline end,
    completed_at = case when p_completed_at is not null then nullif(p_completed_at, '')::date else completed_at end
  where id = p_task_id
  returning * into v_row;

  update public.reports set updated_at = v_now where id = v_row.report_id
  returning * into v_report;

  select tm.name into v_owner_name from public.team_members tm where tm.user_id = v_report.owner_id;

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_row.id,
      'client', v_row.client,
      'projectId', v_row.project_id,
      'task', v_row.task,
      'status', v_row.status,
      'deadline', v_row.deadline,
      'completedAt', v_row.completed_at,
      'assigneeId', v_row.assignee_id,
      'createdAt', v_row.created_at,
      'reportId', v_report.id,
      'reportKind', v_report.kind,
      'weekStart', v_report.week_start,
      'weekEnd', v_report.week_end,
      'date', v_report.report_date,
      'preparedFor', v_report.prepared_for,
      'ownerName', v_owner_name
    ),
    'reportId', v_report.id,
    'updatedAt', v_now
  );
end;
$$;

comment on function public.update_assigned_task(text, text, text, text) is
  'WP3: owner-OR-assignee, NARROW patch (status/deadline/completed_at ONLY -- never task/client/assignee_id/project_id, see this migration''s section 7 header comment). Bumps the parent reports.updated_at = now(). A NULL argument leaves that field untouched; an empty-string deadline/completed_at argument clears it (matching this schema''s existing convention). Raises 42501 (curated to "You don''t have permission to do that.") for an unknown task id OR a caller who is neither the parent report''s owner nor the task''s assignee -- the two cases are deliberately not distinguished, same posture as revoke_api_token. Returns {"task": <AssignedTask-shaped jsonb>, "reportId", "updatedAt"}. lib/server/reports-service.ts''s updateAssignedTask() is the sole TS caller.';

revoke all on function public.update_assigned_task(text, text, text, text) from public, anon;
grant execute on function public.update_assigned_task(text, text, text, text) to authenticated;
