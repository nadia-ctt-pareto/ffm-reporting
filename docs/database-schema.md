# Database Schema — Weekly Reports Dashboard

Baseline schema for the eventual `SupabaseReportsRepository` (see
`lib/data/reports-repository.ts`). **No repository code reads/writes this
schema yet** — MVP persistence is still `LocalStorageReportsRepository`.
This document exists so the shape is reviewed and versioned ahead of the
cutover. The migration itself lives at
`supabase/migrations/20260717000001_initial_schema.sql`, with a Phase 4
delta at `supabase/migrations/20260717000002_daily_reports.sql` and a
Phase 6a delta (the Project entity) at
`supabase/migrations/20260718000003_projects.sql`.

## Discriminated union ↔ single table (Phase 4)

`lib/types.ts` models a report as a discriminated union:

```ts
type AnyReport = WeeklyReport | DailyReport; // kind: 'weekly' | 'daily'
```

Both variants share every field except their period (`weekStart`/`weekEnd`
vs. a single `date`) — see `ReportCore` in `lib/types.ts`. The schema mirrors
this as **one `reports` table**, not two: a `kind` discriminant column plus
a `reports_period_by_kind` CHECK constraint that enforces "exactly the
period columns matching `kind` are set, the other pair is NULL" (mirroring
the TS union's exhaustiveness — a row can never be both/neither). `tasks`,
`risks`, and `priorities` already FK to `reports(id)` and are byte-identical
in shape for both kinds, so splitting into a second `daily_reports` table
would only duplicate every child-table FK and every read/write query path
for no benefit.

**One daily report per day, PER PROJECT BUCKET** (Phase 6a; was "per day,
globally" pre-Phase-6a) is enforced at the SQL layer by a partial
*expression* unique index,
`reports_one_daily_per_day on reports (coalesce(project_id, ''),
report_date) where kind = 'daily'` (see
`supabase/migrations/20260718000003_projects.sql`) — weekly rows'
`report_date` is always NULL (per the CHECK constraint above), so they never
participate in that uniqueness check. A "bucket" is a project (`project_id`
set, for imported dailies, Phase 6b) or "house" (`project_id` NULL, every
report authored directly through the wizard) — two dailies only collide if
they share BOTH a date AND a bucket. **This is deliberately NOT a plain
`(project_id, report_date)` unique index**: Postgres treats NULLs as
distinct in uniqueness checks, so a plain index would never catch two house
dailies (both `project_id IS NULL`) sharing a date — `coalesce(project_id,
'')` folds every house daily into the same non-NULL bucket key so the
constraint is actually enforced for it too. The app enforces the identical
rule at the wizard layer via `sameProjectBucket()` (the TS mirror of this
`coalesce` expression) used by `dailyDateConflict()`/`validateStep()` (step
1, `saveDraft()`, `publish()`) AND `invalidDailyDateEdit()` (the `/daily/[id]`
inline Date-field autosave) — all in `lib/report-utils.ts` — so a collision
surfaces as an inline error instead of a raw constraint violation. A
wizard-created draft always has `projectId` unset (house bucket), so this
scoping is a no-op behavior change for every pre-Phase-6a flow.

## Design decisions

- **Text ids, not `uuid`.** Existing localStorage data (`lib/seed.ts`, and
  anything already persisted in a browser under `ff.reports.v2` — or, pre-
  Phase-4, `ff.weekly-reports.v1`) uses ids like `"r1"`/`"d1"` and
  `"t_abc123_4"` (see `lib/format.ts` `uid()`). Keeping every primary key as
  `text` lets that JSON import verbatim at cutover — zero id remapping.
- **`tasks.client` / `risks.client` stay the denormalized display string;
  `project_id` (Phase 6a) is the optional FK.** The wizard still edits
  `client` via a plain `Input` (`components/wizard/steps/StepTasks.tsx`,
  `StepRisks.tsx`, now with datalist autocomplete suggestions sourced from
  `projects`), not a `Select` bound to a project list -- free text remains
  the source of truth for display and every dedupe predicate (carry-forward
  Import panels, `aggregateDailiesIntoDraft`, CSV export) unchanged.
  `project_id` is pure metadata layered on top, stamped by an exact-name
  backfill (`lib/projects.ts` `ensureProjectIds()` app-side; the mirrored
  `update ... from projects where p.name = t.client` in
  `supabase/migrations/20260718000003_projects.sql` SQL-side) -- never
  fuzzy-matched, never auto-creates a project from a typo'd client string.
  This retires the pre-Phase-6a `TODO(cutover)` that proposed tightening
  `client` itself into a hard FK; `client` intentionally stays free text so
  it always renders even for a project-less (house) report.
- **Win/Touchpoints are columns, not join tables.** `Report['win']` and
  `Report['touchpoints']` are 1:1 with a report in the TS model, so they're
  flattened onto `reports` as `win_*` / `touchpoint_*` columns.
- **`tasks` / `risks` / `priorities` carry a `position` column.** They're
  ordered arrays in the TS model (`Report['tasks'][]`, etc.); `position`
  preserves that order on read-back.
- **RLS is stubbed, not scoped.** Every table has RLS enabled plus one
  `authenticated_full_access` policy (`for all to authenticated using (true)
  with check (true))`. The MVP has no auth yet (localStorage-only, single
  implicit user) — see the `TODO(cutover)` comment in the migration.

## Field mapping: `reports`

`WeeklyReport` and `DailyReport` (Phase 4) share one table — see
"Discriminated union ↔ single table" above. `kind`/`report_date` are new in
`supabase/migrations/20260717000002_daily_reports.sql`; every other column
below predates Phase 4 and is unchanged.

| TS field (`AnyReport`)      | Column                    | Type      | Notes                                    |
| ---------------------------- | ------------------------- | --------- | ----------------------------------------- |
| `id`                         | `id`                      | `text` PK |                                            |
| `kind`                       | `kind`                    | `text`    | `check in ('weekly','daily')`, default `'weekly'`; see `reports_period_by_kind` |
| `weekStart` (weekly only)    | `week_start`               | `date`    | nullable (NULL for `kind = 'daily'`)      |
| `weekEnd` (weekly only)      | `week_end`                 | `date`    | nullable (NULL for `kind = 'daily'`); indexed `(kind, week_end desc)` |
| `date` (daily only)          | `report_date`              | `date`    | nullable (NULL for `kind = 'weekly'`); unique where `kind = 'daily'` (`reports_one_daily_per_day`); indexed `(kind, report_date desc)` |
| `status`                     | `status`                   | `text`    | `check in ('Draft','Final','Sent')`       |
| `preparedFor`                | `prepared_for`             | `text`    |                                            |
| `preparedBy`                 | `prepared_by`              | `text`    |                                            |
| `summaryNarrative`           | `summary_narrative`        | `text`    | default `''`                              |
| `win.stat`                   | `win_stat`                 | `text`    | default `''`                              |
| `win.label`                  | `win_label`                | `text`    | default `''`                              |
| `win.narrative`               | `win_narrative`             | `text`    | default `''`                              |
| `touchpoints.calls`          | `touchpoint_calls`         | `integer` | default `0`                               |
| `touchpoints.emails`         | `touchpoint_emails`        | `integer` | default `0`                               |
| `touchpoints.escalations`    | `touchpoint_escalations`   | `integer` | default `0`                               |
| `touchpoints.narrative`      | `touchpoints_narrative`    | `text`    | default `''`                              |
| `createdAt`                  | `created_at`                | `date`    |                                            |
| `updatedAt`                  | `updated_at`                | `date`    |                                            |
| `projectId`                  | `project_id`                | `text`, nullable | Phase 6a. FK → `projects(id)`. NULL = house-authored, multi-client report; set only for reports imported into a specific project (Phase 6b). Part of the daily-uniqueness bucket key -- see "One daily report per day, PER PROJECT BUCKET" above. |
| `tasks`                      | *(joined from `tasks`)*     | —         | `where report_id = reports.id order by position` |
| `risks`                      | *(joined from `risks`)*     | —         | `where report_id = reports.id order by position` |
| `priorities`                 | *(joined from `priorities`)*| —         | `where report_id = reports.id order by position` |

## Field mapping: `tasks`

| TS field (`Task`) | Column      | Type      | Notes                                             |
| ------------------ | ----------- | --------- | -------------------------------------------------- |
| `id`                | `id`        | `text` PK |                                                     |
| —                   | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`             |
| `client`            | `client`    | `text`    | free text (see design decisions) -- the display/dedupe string |
| `projectId`         | `project_id`| `text`, nullable | Phase 6a. FK → `projects(id)`. Pure metadata, stamped by exact-name backfill (see design decisions) -- does not replace `client`. |
| `task`              | `task`      | `text`    |                                                     |
| `status`            | `status`    | `text`    | `check in ('Complete','In Progress','Blocked')`     |
| `deadline`          | `deadline`  | `date`    | nullable — `''` ↔ `NULL`                            |
| —                   | `position`  | `integer` | preserves array order                               |

## Field mapping: `risks`

| TS field (`Risk`) | Column       | Type      | Notes                                         |
| ------------------ | ------------ | --------- | ----------------------------------------------- |
| `id`                | `id`         | `text` PK |                                                 |
| —                   | `report_id`  | `text`    | FK → `reports(id)`, `on delete cascade`         |
| `client`            | `client`     | `text`    | free text (see design decisions) -- the display/dedupe string |
| `projectId`         | `project_id` | `text`, nullable | Phase 6a. FK → `projects(id)`. See `tasks.project_id` above. |
| `severity`          | `severity`   | `text`    | `check in ('Blocked','At Risk')`                |
| `description`       | `description`| `text`    |                                                 |
| `nextStep`          | `next_step`  | `text`    | default `''`                                    |
| —                   | `position`   | `integer` | preserves array order                           |

## Field mapping: `priorities`

| TS field (`Priority`) | Column      | Type      | Notes                                     |
| ----------------------- | ----------- | --------- | ------------------------------------------ |
| `id`                     | `id`        | `text` PK |                                            |
| —                        | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`    |
| `text`                   | `text`      | `text`    |                                            |
| —                        | `position`  | `integer` | preserves array order                      |

## Field mapping: `projects`

Phase 6a: `projects` is a real TS entity now (`Project { id, name }`,
`lib/types.ts` via `lib/schema/project.ts`'s `ProjectSchema`), not just a
reference table -- renamed from `clients` in
`supabase/migrations/20260718000003_projects.sql` (`client = project`).
Seeded from `lib/seed.ts`'s `seedProjects()`, which hardcodes the same four
slug/name pairs the SQL `insert` uses verbatim (not derived via
`slugifyProjectName()`, so the two seeds can never drift apart).
`lib/constants.ts`'s `FF_CLIENTS` remains the client-name source for
`seedReports()`/`seedDailyReports()` (the ~50 task/risk `client` strings) --
it is NOT `seedProjects()`'s source; the project seed is an independent
verbatim copy, deliberately not derived from `FF_CLIENTS`.

| TS field (`Project`) | Column | Type              | Notes                                  |
| ---------------------- | ------ | ----------------- | --------------------------------------- |
| `id`                    | `id`   | `text` PK          | slug (e.g. `helitech-foundation-waterproofing`) |
| `name`                  | `name` | `text`, `unique`   | exact display string used throughout the UI |

## Cutover checklist

1. Implement `SupabaseReportsRepository` in `lib/data/`, satisfying the
   existing `ReportsRepository` interface (`getAll`/`getAllDaily`/`getById`/
   `upsert`/`update`/`getProjects`/`upsertProject`, the latter two added
   Phase 6a) — UI code never changes, since it only ever calls
   `getReportsRepository()` (`lib/data/index.ts`). `getAll()` filters to
   `kind = 'weekly'`, `getAllDaily()` to `kind = 'daily'` — both against the
   same `reports` table (see "Discriminated union ↔ single table" above).
2. Map camelCase (TS) ↔ snake_case (SQL) per the field-mapping tables above.
   `getAll`/`getAllDaily`/`getById` join `tasks`/`risks`/`priorities`
   (ordered by `position`) back into each report object, and reconstruct
   the TS union (`kind = 'weekly'` rows get `weekStart`/`weekEnd`, `kind =
   'daily'` rows get `date`, per `reports_period_by_kind`); `upsert`/`update`
   write the `reports` row plus replace its child rows (delete + reinsert by
   `report_id`, re-deriving `position` from array order, is the simplest
   correct strategy given these are small per-report lists).
3. One-time import: read every existing browser's `ff.reports.v2`
   localStorage payload (both kinds — the pre-Phase-4 `ff.weekly-reports.v1`
   key is superseded by it, see `LocalStorageReportsRepository`'s v1→v2
   migration) and `upsert` each `AnyReport` through the new repository (ids
   import verbatim — see "Text ids" above). **Phase 6a addition:** also read
   `ff.projects.v1` (`Project[]`) and `upsert` each through the new
   repository's `upsertProject()` BEFORE importing reports (so the FK
   references resolve); every task/risk/report's `projectId` (already
   backfilled client-side by `ensureProjectIds()`, or `null`/absent for a
   house record) must be carried through into the corresponding
   `tasks.project_id` / `risks.project_id` / `reports.project_id` columns,
   not dropped.
4. Swap the single switch point: `getReportsRepository()` in
   `lib/data/index.ts` returns `SupabaseReportsRepository` instead of
   `LocalStorageReportsRepository`.
5. Post-cutover drift check: run `supabase gen types typescript` and diff
   the generated types against `lib/types.ts` / this document whenever
   either changes, to catch schema/type drift early.

See also `CLAUDE.md`: *"Any PR that changes `lib/types.ts` domain shapes
must add a `supabase/migrations/*.sql` delta and update the mapping tables
in this document."*
