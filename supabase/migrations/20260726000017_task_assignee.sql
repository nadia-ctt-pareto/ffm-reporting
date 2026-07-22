-- Weekly Reports Dashboard -- Task assignee + creation date delta (WP2).
--
-- Adds two nullable columns to `tasks`:
--
--   - `assignee_id text references team_members (id)` -- an OPTIONAL FK to
--     WP1's team directory (supabase/migrations/20260726000016_team_members.sql).
--     NULL/absent means "unassigned" (the default for every existing row,
--     and for any task a PM hasn't gotten around to assigning yet) -- this
--     is pure task-ownership metadata, exactly like `tasks.project_id`
--     (supabase/migrations/20260718000003_projects.sql): it never replaces
--     the free-text `client` column, and nothing here grants the assignee
--     any special access to the task's report (WP1's header comment is
--     explicit that `team_members` carries no permission meaning by
--     itself; the RLS access flip that WOULD wire "assignee can edit their
--     own tasks" into a real policy is a LATER, explicitly out-of-scope
--     package -- see CLAUDE.md's Roadmap).
--   - `created_at date` -- the day THIS task ROW was first authored, the
--     SAME `date` (not `timestamptz`) type and NULL-means-"not recorded"
--     convention `completed_at` already uses (supabase/migrations/
--     20260725000014_task_completed_at.sql). NULL for every row that
--     existed before this migration (their true creation date was never
--     captured) and for a carried-forward/imported/aggregated task copy
--     (see docs/database-schema.md's "Task assignee and creation date
--     (WP2)" section for why those paths deliberately leave it unstamped
--     rather than inventing a value) -- only genuinely NEW task rows
--     (wizard "Add Task", the `/tasks` Add Task dialog, a CSV import row,
--     an MCP `create_report` call) get a real value, stamped by the app at
--     the moment of creation, never user-typed and never backfilled.
--
-- FK is `NO ACTION` (Postgres's default when no `ON DELETE`/`ON UPDATE`
-- clause is given) -- deliberately, matching the `projects` FK precedent
-- (`reports.project_id`/`tasks.project_id`/`risks.project_id`, none of
-- which cascade or set-null): deleting a team member who still has tasks
-- assigned to them must FAIL loudly, not silently orphan the reference
-- (set null) or delete unrelated task/report rows (cascade) -- an assigned
-- task is real, attributed work, and losing that attribution silently
-- would be a data-integrity regression, not a convenience.
--
-- `lib/server/reports-service.ts`'s `deleteTeamMember` already intercepts
-- sqlstate 23503 itself (forward-declared in WP1, before any FK actually
-- referenced `team_members`) and `curatedMessage`'s `'conflict'` branch
-- already matches `_assignee_id_fkey` (also forward-declared in WP1) --
-- Postgres's default constraint-naming convention (`<table>_<column>_fkey`)
-- names the constraint this migration creates `tasks_assignee_id_fkey`,
-- which that regex matches WITHOUT any change to either function. Verified
-- by re-reading both: `lib/server/reports-service.ts`'s `deleteTeamMember`
-- (around the sqlstate-23503 branch) and `curatedMessage`'s `'conflict'`
-- case (the `/_assignee_id_fkey|_team_member_id_fkey/` regex) -- no edits
-- needed to either.
--
-- No RLS policy on `tasks` or `team_members` is touched here -- WP3 (the
-- RLS access flip) owns any future policy change; this migration is
-- schema-only, same posture as `20260725000014_task_completed_at.sql`.

alter table tasks
  add column assignee_id text references team_members (id),
  add column created_at date;

create index tasks_assignee_id_idx on tasks (assignee_id);

comment on column tasks.assignee_id is
  'Task.assigneeId (lib/types.ts). Nullable FK -> team_members(id), NO ACTION (deleting an assigned-to team member must fail, not orphan/cascade -- see this migration''s header comment). Pure task-ownership metadata, like project_id -- carries no permission meaning and never replaces the free-text client column. NULL = unassigned (the default).';

comment on column tasks.created_at is
  'Task.createdAt (lib/types.ts). Nullable date -- NULL/absent means "not recorded" (mirrors deadline/completed_at''s '''' <-> NULL convention). Stamped ONLY at genuine creation (wizard Add Task, the /tasks Add Task dialog, a CSV import row, an MCP create_report call) -- never re-stamped or backfilled on a carry-forward/import-selected/aggregated task copy, and never user-editable after the fact. See docs/database-schema.md''s "Task assignee and creation date (WP2)" section for the full design reasoning.';

-- ---------------------------------------------------------------------------
-- `replace_reports` (supabase/migrations/20260719000004_auth_ownership.sql,
-- last redefined by 20260725000014_task_completed_at.sql, which added
-- `completed_at`) inserts `tasks` via an EXPLICIT column list, not a
-- dynamic jsonb-key expansion -- so `assignee_id`/`created_at` would
-- silently never persist through the transactional write path (CSV
-- import, the localStorage->Supabase import, and `updateReport`'s
-- single-row write, per that function's own comment) unless it's
-- re-declared here too. This CREATE OR REPLACE is byte-identical to the
-- `...014` version except the `tasks` insert now also carries
-- `assignee_id`/`created_at` -- every other column, the
-- `reports`/`risks`/`priorities` inserts, the server-stamped `updated_at`
-- behavior, and the `updatedAt` return map are all unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.replace_reports(payload jsonb, skip_existing boolean default false)
returns jsonb
language plpgsql
security invoker
as $$
declare
  imported text[] := array[]::text[];
  skipped text[] := array[]::text[];
  updated_ats jsonb := '{}'::jsonb;
  rec jsonb;
  rid text;
  rec_updated_at timestamptz;
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
      -- `updated_at` is server-stamped below (20260720000005's SECTION 2
      -- fix, unchanged here) -- the payload's own `updated_at` is
      -- intentionally never read here.
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
      -- Server-stamped, not `excluded.updated_at` (20260720000005's SECTION
      -- 2 fix, unchanged here) -- see the header note above.
      updated_at              = now(),
      project_id              = excluded.project_id
      -- owner_id intentionally NOT overwritten on conflict -- preserves the
      -- existing row's owner_id, per the plan this migration implements.
      -- share_token is untouched here for the same reason (see header note).
    returning updated_at into rec_updated_at;

    delete from tasks where report_id = rid;
    delete from risks where report_id = rid;
    delete from priorities where report_id = rid;

    insert into tasks (id, report_id, client, project_id, task, status, deadline, completed_at, assignee_id, created_at, position)
    select
      t.val ->> 'id', rid, t.val ->> 'client', t.val ->> 'project_id', t.val ->> 'task', t.val ->> 'status',
      nullif(t.val ->> 'deadline', '')::date, nullif(t.val ->> 'completed_at', '')::date,
      nullif(t.val ->> 'assignee_id', ''), nullif(t.val ->> 'created_at', '')::date, (t.ord - 1)::int
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
    updated_ats := updated_ats || jsonb_build_object(rid, to_jsonb(rec_updated_at));
  end loop;

  return jsonb_build_object('imported', to_jsonb(imported), 'skipped', to_jsonb(skipped), 'updatedAt', updated_ats);
end;
$$;

comment on function public.replace_reports(jsonb, boolean) is
  'Transactional upsert of a report + its tasks/risks/priorities in one round-trip (7b''s CSV import / localStorage->Supabase import / updateReport''s single-row write all call this). SECURITY INVOKER: runs as the calling authenticated role, so every RLS policy above still applies -- this only adds atomicity, never privilege escalation. skip_existing=true skips (and reports) any id already present instead of overwriting it. updated_at is ALWAYS server-stamped to now() -- a client-supplied updated_at in the payload is ignored on both insert and conflict-update. Result carries "updatedAt", a jsonb object mapping every imported (non-skipped) id to the real updated_at it was just stamped with. WP2 (task assignee + creation date): the tasks insert now also carries assignee_id (nullable FK -> team_members) and created_at (nullable date, NEVER re-stamped here -- a NULL/absent value in the payload stays NULL, exactly like completed_at). Returns {"imported": [ids], "skipped": [ids], "updatedAt": {"<id>": "<timestamptz>", ...}}.';

-- Grants unchanged from 20260719000004_auth_ownership.sql (CREATE OR
-- REPLACE preserves existing privileges) -- restated here only so this
-- file is self-checkable without cross-referencing the prior migrations:
-- `authenticated` only, RLS (SECURITY INVOKER) is the real gate.
