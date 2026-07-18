-- Weekly Reports Dashboard -- Phase 6a delta: the Project entity.
--
-- Renames `clients` to `projects` (client = project, per lib/types.ts's new
-- `Project { id, name }` entity -- see docs/database-schema.md) and adds an
-- optional `project_id` FK to `reports`/`tasks`/`risks`, mirroring the app's
-- lazy exact-name backfill (lib/projects.ts ensureProjectIds()).
--
-- Constraint/index names below were verified against
-- supabase/migrations/20260717000001_initial_schema.sql's actual DDL
-- (`create table clients (id text primary key, name text not null unique)`)
-- -- Postgres's default names for an inline `primary key` and an inline
-- `unique` on that table are exactly `clients_pkey` / `clients_name_key`.

-- ---------------------------------------------------------------------------
-- clients -> projects
-- ---------------------------------------------------------------------------

alter table clients rename to projects;
alter index clients_pkey rename to projects_pkey;
alter table projects rename constraint clients_name_key to projects_name_key;
-- RLS + the authenticated_full_access policy survive a rename (attached to the table, not its name).

comment on table projects is 'Foundation First Marketing''s clients/projects (lib/types.ts Project). Renamed from `clients` in Phase 6a -- client = project. FK''d from reports/tasks/risks below.';

-- ---------------------------------------------------------------------------
-- reports / tasks / risks: add project_id
-- ---------------------------------------------------------------------------

alter table reports add column project_id text references projects (id);
alter table tasks   add column project_id text references projects (id);
alter table risks   add column project_id text references projects (id);

comment on column reports.project_id is 'Report[''projectId'']. The Project an IMPORTED report belongs to -- NULL for house-authored, multi-client reports (the "house" bucket). See reports_one_daily_per_day below.';
comment on column tasks.project_id is 'Task[''projectId'']. Pure metadata (consolidation grouping) -- `client` stays the free-text display/dedupe string, unchanged by this column. Stamped by exact-name backfill, mirrored below.';
comment on column risks.project_id is 'Risk[''projectId'']. See tasks.project_id.';

-- Mirror of the app's lazy backfill (lib/projects.ts ensureProjectIds()): exact display-name match only, never fuzzy.
update tasks t set project_id = p.id from projects p where p.name = t.client and t.project_id is null;
update risks r set project_id = p.id from projects p where p.name = r.client and r.project_id is null;
-- reports.project_id stays NULL for existing rows (house multi-client reports) -- there is no report-level "client" column to backfill from.

-- ---------------------------------------------------------------------------
-- One daily report per day, PER PROJECT BUCKET (was: per day, globally).
-- ---------------------------------------------------------------------------
-- Imported dailies (Phase 6b) may share a calendar date with a house daily
-- or with a daily from a different project -- only same-bucket dailies must
-- stay unique. NOT a plain `(project_id, report_date)` unique index:
-- Postgres treats NULLs as distinct in uniqueness checks, which would
-- silently stop enforcing the rule for the project_id IS NULL (house)
-- bucket (every house daily's project_id is NULL, so a plain index would
-- never see two of them as a duplicate). `coalesce(project_id, '')` folds
-- every house daily into the same non-NULL bucket key, so the constraint is
-- actually enforced for it too. Mirrored in the app by `sameProjectBucket()`
-- (lib/report-utils.ts), used by `dailyDateConflict()`/`invalidDailyDateEdit()`.

drop index reports_one_daily_per_day;
create unique index reports_one_daily_per_day
  on reports (coalesce(project_id, ''), report_date) where kind = 'daily';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index tasks_project_id_idx on tasks (project_id);
create index risks_project_id_idx on risks (project_id);
create index reports_project_id_idx on reports (project_id);
