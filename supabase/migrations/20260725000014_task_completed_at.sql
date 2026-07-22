-- Weekly Reports Dashboard -- Task completion date delta.
--
-- Adds a single nullable column, `tasks.completed_at date`, so the Schedule
-- view (`lib/task-schedule.ts`, `/tasks?view=schedule`) can classify a
-- task's on-time/late timing to the DAY when a real completion date is on
-- record, instead of always falling back to which WEEK a report covered
-- (see that file's own header comment for the "week, not a day" caveat this
-- closes). Purely additive: no existing column changes shape, no existing
-- row needs a value, and the app treats an absent/NULL value exactly like
-- `deadline`'s own '' <-> NULL convention (lib/schema/report.ts's
-- `TaskSchema.completedAt` doc comment).
--
-- Auto-stamped, not user-typed by default: the app (lib/report-utils.ts's
-- `taskCompletionStamp`) sets this the moment a task's status becomes
-- 'Complete' through any write path (wizard Status select, the task modal,
-- a Kanban drag to the Complete column), and clears it the moment a task
-- moves back OFF 'Complete' -- but it stays a genuinely editable date field
-- afterward (components/tasks/TaskDialog.tsx's "Completed On" input), since
-- reports are often written up days after the fact and a PM needs to be
-- able to correct the recorded day. See docs/database-schema.md's "Task
-- completion date" section for the full read/write story across every
-- layer this touches (Zod, db-mapping, CSV, MCP, the Schedule view).

alter table tasks add column completed_at date;

comment on column tasks.completed_at is
  'Task.completedAt (lib/types.ts). Nullable -- NULL/absent means "not recorded" (mirrors deadline''s '' <-> NULL convention). Auto-stamped to the current date the moment a task''s status becomes ''Complete'' through any write path (wizard Status select, the task detail/Kanban-add modal, a Kanban drag to the Complete column -- see lib/report-utils.ts''s taskCompletionStamp, the single place this rule lives), and cleared the moment a task moves back off ''Complete''. Editable afterward by a PM (a report is often written up days after the actual day) without being re-clobbered by the auto-stamp rule, which only ever fires on an actual status CHANGE, never on an unrelated field edit. Powers lib/task-schedule.ts''s day-level (not just week-level) on-time/late classification when present; a task with no completed_at still falls back to the pre-existing week-level inference, unaffected by this column''s addition.';

-- ---------------------------------------------------------------------------
-- `replace_reports` (supabase/migrations/20260719000004_auth_ownership.sql,
-- last redefined by 20260720000006_post_review_hardening_round2.sql) inserts
-- `tasks` via an EXPLICIT column list, not a dynamic jsonb-key expansion --
-- so the new column would silently never persist through the transactional
-- write path (CSV import, the localStorage->Supabase import, and
-- `updateReport`'s single-row write, per that function's own comment) unless
-- it's re-declared here too. This CREATE OR REPLACE is byte-identical to the
-- round-2 version except the `tasks` insert now also carries `completed_at`
-- -- every other column, the `reports`/`risks`/`priorities` inserts, the
-- server-stamped `updated_at` behavior, and the `updatedAt` return map are
-- all unchanged.
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

    insert into tasks (id, report_id, client, project_id, task, status, deadline, completed_at, position)
    select
      t.val ->> 'id', rid, t.val ->> 'client', t.val ->> 'project_id', t.val ->> 'task', t.val ->> 'status',
      nullif(t.val ->> 'deadline', '')::date, nullif(t.val ->> 'completed_at', '')::date, (t.ord - 1)::int
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
  'Transactional upsert of a report + its tasks/risks/priorities in one round-trip (7b''s CSV import / localStorage->Supabase import / updateReport''s single-row write all call this). SECURITY INVOKER: runs as the calling authenticated role, so every RLS policy above still applies -- this only adds atomicity, never privilege escalation. skip_existing=true skips (and reports) any id already present instead of overwriting it. updated_at is ALWAYS server-stamped to now() -- a client-supplied updated_at in the payload is ignored on both insert and conflict-update. Result carries "updatedAt", a jsonb object mapping every imported (non-skipped) id to the real updated_at it was just stamped with. Task completion date delta: the tasks insert now also carries completed_at (nullable date, '' -> NULL like deadline). Returns {"imported": [ids], "skipped": [ids], "updatedAt": {"<id>": "<timestamptz>", ...}}.';

-- Grants unchanged from 20260719000004_auth_ownership.sql (CREATE OR
-- REPLACE preserves existing privileges) -- restated here only so this
-- file is self-checkable without cross-referencing the prior migrations:
-- `authenticated` only, RLS (SECURITY INVOKER) is the real gate.
