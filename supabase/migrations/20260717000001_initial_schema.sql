-- Weekly Reports Dashboard -- initial schema.
--
-- Mirrors the current TypeScript domain model (lib/types.ts) as of Phase 1
-- (Foundation). This is a *baseline* migration only: no repository code
-- reads/writes this schema yet (MVP persistence is still
-- LocalStorageReportsRepository, see lib/data/). It exists so the shape is
-- reviewed and versioned ahead of the SupabaseReportsRepository cutover.
-- See docs/database-schema.md for the full field-mapping tables and the
-- cutover checklist.
--
-- Design notes:
--   * All primary keys are `text`, not `uuid` -- the existing localStorage
--     data (lib/seed.ts, and anything a browser has already persisted under
--     `ff.weekly-reports.v1`) uses ids like "r1", "t_abc123_4"; keeping ids
--     as text lets that JSON import verbatim at cutover with zero id
--     remapping.
--   * `tasks.client` / `risks.client` stay free-text, matching the wizard's
--     current `Input` (not a `Select` bound to a client list) -- see
--     CLAUDE.md: "Any PR that changes lib/types.ts domain shapes must add a
--     migration delta...". `clients` is seeded from lib/constants.ts'
--     FF_CLIENTS for future reference/reporting, but there is no FK from
--     tasks/risks to it yet. TODO(cutover): tighten `tasks.client` /
--     `risks.client` to a FK once client management ships.
--   * Win (`win_*`) and Touchpoints (`touchpoint_*`) are 1:1 with a report
--     in the TS model (Report['win'], Report['touchpoints']) -- they're
--     flattened into columns on `reports`, not separate join tables.
--   * `tasks` / `risks` / `priorities` are ordered arrays in the TS model
--     (Report['tasks'][], etc.) -- `position` preserves that order.

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table clients (
  id text primary key,
  name text not null unique
);

comment on table clients is 'Reference list of Foundation First Marketing''s active clients (lib/constants.ts FF_CLIENTS). Not yet FK''d from tasks/risks -- see file header.';

insert into clients (id, name) values
  ('helitech-foundation-waterproofing', 'Helitech Foundation & Waterproofing'),
  ('dryroot-waterproofing', 'DryRoot Waterproofing'),
  ('summit-basement-solutions', 'Summit Basement Solutions'),
  ('terrafirm-foundation-repair', 'TerraFirm Foundation Repair');

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------

create table reports (
  id text primary key,
  week_start date not null,
  week_end date not null,
  status text not null check (status in ('Draft', 'Final', 'Sent')),
  prepared_for text not null,
  prepared_by text not null,
  summary_narrative text not null default '',
  -- Win (Report['win']), flattened.
  win_stat text not null default '',
  win_label text not null default '',
  win_narrative text not null default '',
  -- Touchpoints (Report['touchpoints']), flattened.
  touchpoint_calls integer not null default 0,
  touchpoint_emails integer not null default 0,
  touchpoint_escalations integer not null default 0,
  touchpoints_narrative text not null default '',
  created_at date not null,
  updated_at date not null
);

comment on table reports is 'One row per weekly report. See docs/database-schema.md for the full Report <-> row field mapping.';

create index reports_week_end_idx on reports (week_end desc);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table tasks (
  id text primary key,
  report_id text not null references reports (id) on delete cascade,
  client text not null,
  task text not null,
  status text not null check (status in ('Complete', 'In Progress', 'Blocked')),
  -- Draft/Report['tasks'][number]['deadline'] is '' when unset; that maps to
  -- NULL here, not an empty string.
  deadline date,
  position integer not null
);

create index tasks_report_id_idx on tasks (report_id);

-- ---------------------------------------------------------------------------
-- risks
-- ---------------------------------------------------------------------------

create table risks (
  id text primary key,
  report_id text not null references reports (id) on delete cascade,
  client text not null,
  severity text not null check (severity in ('Blocked', 'At Risk')),
  description text not null,
  next_step text not null default '',
  position integer not null
);

create index risks_report_id_idx on risks (report_id);

-- ---------------------------------------------------------------------------
-- priorities
-- ---------------------------------------------------------------------------

create table priorities (
  id text primary key,
  report_id text not null references reports (id) on delete cascade,
  text text not null,
  position integer not null
);

create index priorities_report_id_idx on priorities (report_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- TODO(cutover): scope these to org/user once auth exists. The MVP has no
-- auth yet (localStorage-only, single implicit user) -- these stub policies
-- just allow any authenticated Supabase user full access, so the schema is
-- immediately usable once SupabaseReportsRepository lands, without blocking
-- on an auth design that's out of scope for Phase 1.

alter table clients enable row level security;
alter table reports enable row level security;
alter table tasks enable row level security;
alter table risks enable row level security;
alter table priorities enable row level security;

create policy "authenticated_full_access" on clients for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on reports for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on tasks for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on risks for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on priorities for all to authenticated using (true) with check (true);
