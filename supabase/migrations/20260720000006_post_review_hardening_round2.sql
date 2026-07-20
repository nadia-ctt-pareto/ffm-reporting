-- Weekly Reports Dashboard -- Phase 7b delta: round-2 review findings
-- against the (uncommitted) M1+M2 data-plane work, closed at the SQL layer.
--
-- =============================================================================
-- 1) BLOCKER A -- match the app's write-boundary length/count caps with real
--    SQL CHECK constraints, so Zod and Postgres cannot silently disagree.
-- =============================================================================
-- Round 1 (SHOULD-FIX 8) added `.max()` length/count caps to
-- lib/schema/report.ts, but landed them on the shared read/row schema
-- (`ReportCoreSchema`) rather than only the write-boundary `*InputSchema`
-- variants -- and Postgres had NO matching constraint at all: every
-- `reports`/`tasks`/`risks`/`priorities` text column is unbounded `text`.
-- Confirmed exploited end-to-end: any report owner can `PATCH` an
-- over-cap value (e.g. a 25,000-character `summary_narrative`) into their
-- OWN report through the public anon key -- `reports_update` RLS permits it,
-- since they own the row -- and because `lib/server/reports-service.ts`'s
-- `mapRow` used to THROW for the whole request on a failed parse, and
-- `reports_select` is `using (true)` (every authenticated user can read
-- every report), `GET /api/reports` 500'd for EVERY user in the org,
-- including admins, with no in-app recovery.
--
-- The fix has three independent, complementary layers (see
-- lib/schema/report.ts's `ReportCoreSchema` doc comment and
-- lib/server/reports-service.ts's `listReports` for the other two):
--   1. The `.max()` caps moved OFF the read schema onto the `*InputSchema`
--      write-boundary variants (app-layer code, this same commit).
--   2. THIS migration: matching SQL CHECK constraints, so a client bypassing
--      this app entirely (raw PostgREST + the anon key + their own JWT) is
--      ALSO capped at the database layer, not just through this app's own
--      `POST`/`PATCH` handlers.
--   3. `listReports` (app-layer code, this same commit) now skip-and-logs a
--      single non-conforming row instead of throwing for the whole batch --
--      a backstop for the case where the schema/DB disagree despite (1)/(2),
--      degrading to "one report missing from the list" instead of "the
--      whole list is down."
--
-- Bounds mirror lib/schema/report.ts's MAX_ID_LEN (200) / MAX_SHORT_TEXT
-- (500) / MAX_LONG_TEXT (20,000) / touchpoints numeric cap (100,000)
-- exactly -- see that file for the rationale behind the specific numbers
-- (generous relative to any real weekly/daily report; these exist to reject
-- a pathological payload, not to constrain legitimate use). Verified against
-- the actual seed data (supabase/seed.sql, lib/seed.ts) before landing --
-- the longest existing field is well under 300 characters, so this
-- ALTER TABLE ... ADD CONSTRAINT (which validates every existing row by
-- default) cannot fail against real data.

alter table reports add constraint reports_id_len check (char_length(id) <= 200);
alter table reports add constraint reports_prepared_for_len check (char_length(prepared_for) <= 500);
alter table reports add constraint reports_prepared_by_len check (char_length(prepared_by) <= 500);
alter table reports add constraint reports_summary_narrative_len check (char_length(summary_narrative) <= 20000);
alter table reports add constraint reports_win_stat_len check (char_length(win_stat) <= 500);
alter table reports add constraint reports_win_label_len check (char_length(win_label) <= 500);
alter table reports add constraint reports_win_narrative_len check (char_length(win_narrative) <= 20000);
alter table reports add constraint reports_touchpoints_narrative_len check (char_length(touchpoints_narrative) <= 20000);
alter table reports add constraint reports_touchpoint_calls_range check (touchpoint_calls between 0 and 100000);
alter table reports add constraint reports_touchpoint_emails_range check (touchpoint_emails between 0 and 100000);
alter table reports add constraint reports_touchpoint_escalations_range check (touchpoint_escalations between 0 and 100000);
alter table reports add constraint reports_project_id_len check (project_id is null or char_length(project_id) <= 200);

alter table tasks add constraint tasks_id_len check (char_length(id) <= 200);
alter table tasks add constraint tasks_client_len check (char_length(client) <= 500);
alter table tasks add constraint tasks_task_len check (char_length(task) <= 20000);
alter table tasks add constraint tasks_project_id_len check (project_id is null or char_length(project_id) <= 200);

alter table risks add constraint risks_id_len check (char_length(id) <= 200);
alter table risks add constraint risks_client_len check (char_length(client) <= 500);
alter table risks add constraint risks_description_len check (char_length(description) <= 20000);
alter table risks add constraint risks_next_step_len check (char_length(next_step) <= 20000);
alter table risks add constraint risks_project_id_len check (project_id is null or char_length(project_id) <= 200);

alter table priorities add constraint priorities_id_len check (char_length(id) <= 200);
alter table priorities add constraint priorities_text_len check (char_length(text) <= 20000);

-- ---------------------------------------------------------------------------
-- Child-row-count cap (BLOCKER A, part 2, "if practical"): the round-1
-- `.max(500)` array-length cap on tasks/risks/priorities only ever applied
-- to what THIS app's `POST /api/reports`/`PATCH` handlers accept -- it
-- can't stop a client from directly `INSERT`ing unlimited rows into
-- `tasks`/`risks`/`priorities` via PostgREST, since `tasks_insert` (and its
-- risks/priorities siblings) only check ownership of the parent report, not
-- a row count. A per-row `AFTER INSERT` trigger (rather than a
-- statement-level trigger over a transition table) is the simplest
-- correct implementation -- `report_id` is already indexed
-- (tasks_report_id_idx / risks_report_id_idx / priorities_report_id_idx),
-- so each check is a cheap indexed count; the app's own `.max(500)` caps
-- how many times this can possibly fire per report per request in
-- practice, so the per-row overhead never compounds into something
-- pathological the way an UNBOUNDED insert's trigger cost could.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_child_row_cap()
returns trigger
language plpgsql
as $$
declare
  max_rows constant integer := 500;
  row_count integer;
begin
  execute format('select count(*) from public.%I where report_id = $1', TG_TABLE_NAME)
    into row_count
    using NEW.report_id;
  if row_count > max_rows then
    raise exception 'Report % already has the maximum of % % rows.', NEW.report_id, max_rows, TG_TABLE_NAME
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

comment on function public.enforce_child_row_cap() is
  'BLOCKER A (post-review round 2): raises a check_violation (23514, mapped to HTTP 400 by lib/server/reports-service.ts''s mapPgError) once a report''s tasks/risks/priorities row count exceeds 500 -- the SQL-layer backstop for lib/schema/report.ts''s MAX_CHILD_ROWS, which only guards this app''s own POST/PATCH handlers, not a direct PostgREST insert.';

drop trigger if exists tasks_row_cap on tasks;
create trigger tasks_row_cap after insert on tasks for each row execute function public.enforce_child_row_cap();

drop trigger if exists risks_row_cap on risks;
create trigger risks_row_cap after insert on risks for each row execute function public.enforce_child_row_cap();

drop trigger if exists priorities_row_cap on priorities;
create trigger priorities_row_cap after insert on priorities for each row execute function public.enforce_child_row_cap();

-- =============================================================================
-- 2) SHOULD-FIX C -- `replace_reports` now RETURNS the real, just-written
--    `updated_at` for every report it touched, so `updateReport`
--    (lib/server/reports-service.ts) never has to fabricate one from this
--    Node process's own clock.
-- =============================================================================
-- Round 1 made `replace_reports` server-stamp `updated_at = now()` itself
-- (correct), but `updateReport`'s TS code still computed its OWN
-- `new Date().toISOString()` for the value it returns to the caller --
-- meaningless dead weight while that return value was discarded, but
-- SHOULD-FIX 14 (round 1) now writes it straight into React state, so a
-- client/DB clock-skew or a request straddling a UTC-midnight boundary
-- could show the user a date the row doesn't actually have. Fixed by having
-- this function report back what it ACTUALLY wrote: the result gains an
-- `updatedAt` key, a jsonb object mapping every imported (non-skipped) id to
-- its now-current `updated_at` (full ISO-8601 instant) -- captured via
-- `INSERT ... ON CONFLICT DO UPDATE ... RETURNING updated_at`, no extra
-- round-trip needed. `updateReport` looks up its own single id in this map.

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
    updated_ats := updated_ats || jsonb_build_object(rid, to_jsonb(rec_updated_at));
  end loop;

  return jsonb_build_object('imported', to_jsonb(imported), 'skipped', to_jsonb(skipped), 'updatedAt', updated_ats);
end;
$$;

comment on function public.replace_reports(jsonb, boolean) is
  'Transactional upsert of a report + its tasks/risks/priorities in one round-trip (7b''s CSV import / localStorage->Supabase import / updateReport''s single-row write all call this). SECURITY INVOKER: runs as the calling authenticated role, so every RLS policy above still applies -- this only adds atomicity, never privilege escalation. skip_existing=true skips (and reports) any id already present instead of overwriting it. updated_at is ALWAYS server-stamped to now() (20260720000005''s post-review hardening) -- a client-supplied updated_at in the payload is ignored on both insert and conflict-update. Post-review round 2 (SHOULD-FIX C): the result now also carries "updatedAt", a jsonb object mapping every imported (non-skipped) id to the real updated_at it was just stamped with -- lib/server/reports-service.ts''s updateReport echoes this back to its caller instead of fabricating a value from its own process clock. Returns {"imported": [ids], "skipped": [ids], "updatedAt": {"<id>": "<timestamptz>", ...}}.';

-- Grants unchanged from 20260719000004_auth_ownership.sql (CREATE OR
-- REPLACE preserves existing privileges) -- restated here only so this
-- file is self-checkable without cross-referencing the prior migrations:
-- `authenticated` only, RLS (SECURITY INVOKER) is the real gate.
