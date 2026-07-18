# Database Schema — Weekly Reports Dashboard

Baseline schema for the eventual `SupabaseReportsRepository` (see
`lib/data/reports-repository.ts`). **No repository code reads/writes this
schema yet** — MVP persistence is still `LocalStorageReportsRepository`.
This document exists so the shape is reviewed and versioned ahead of the
cutover. The migration itself lives at
`supabase/migrations/20260717000001_initial_schema.sql`, with a Phase 4
delta at `supabase/migrations/20260717000002_daily_reports.sql`.

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

**One daily report per day, covering all clients** (not per-client) is
enforced at the SQL layer by a partial unique index,
`reports_one_daily_per_day on reports (report_date) where kind = 'daily'`
— weekly rows' `report_date` is always NULL (per the CHECK constraint
above), so they never participate in that uniqueness check. The app enforces
the same rule at the wizard layer (`dailyDateConflict`/`validateStep` in
`lib/report-utils.ts`) so a collision surfaces as an inline wizard error
instead of a raw constraint violation.

**Phase 6 known trap — record it now so it's not lost**: the current index
definition `unique(report_date) where kind='daily'` will break the moment
dailies from different projects share a date (Phase 6 is adding a Project
entity; `client` becomes a denormalized display name, `projectId` is added).
The index must become an expression index on `(coalesce(project_id, ''),
report_date)` — **a plain `(project_id, report_date)` index would NOT work**
because Postgres treats NULLs as distinct in uniqueness checks. The wizard's
`dailyDateConflict` function in `lib/report-utils.ts` must be scoped
identically when that PR lands.

## Design decisions

- **Text ids, not `uuid`.** Existing localStorage data (`lib/seed.ts`, and
  anything already persisted in a browser under `ff.reports.v2` — or, pre-
  Phase-4, `ff.weekly-reports.v1`) uses ids like `"r1"`/`"d1"` and
  `"t_abc123_4"` (see `lib/format.ts` `uid()`). Keeping every primary key as
  `text` lets that JSON import verbatim at cutover — zero id remapping.
- **`tasks.client` / `risks.client` are free text, not a client FK.** The
  wizard currently edits both via a plain `Input` (`components/wizard/steps/
  StepTasks.tsx`, `StepRisks.tsx`), not a `Select` bound to a client list —
  there's no client-management UI yet. `clients` is seeded from
  `lib/constants.ts`' `FF_CLIENTS` for future reference/reporting, but
  nothing FKs to it yet. **TODO(cutover):** tighten `tasks.client` /
  `risks.client` to a real FK once client management ships.
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
| `tasks`                      | *(joined from `tasks`)*     | —         | `where report_id = reports.id order by position` |
| `risks`                      | *(joined from `risks`)*     | —         | `where report_id = reports.id order by position` |
| `priorities`                 | *(joined from `priorities`)*| —         | `where report_id = reports.id order by position` |

## Field mapping: `tasks`

| TS field (`Task`) | Column      | Type      | Notes                                             |
| ------------------ | ----------- | --------- | -------------------------------------------------- |
| `id`                | `id`        | `text` PK |                                                     |
| —                   | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`             |
| `client`            | `client`    | `text`    | free text, no FK (see design decisions)             |
| `task`              | `task`      | `text`    |                                                     |
| `status`            | `status`    | `text`    | `check in ('Complete','In Progress','Blocked')`     |
| `deadline`          | `deadline`  | `date`    | nullable — `''` ↔ `NULL`                            |
| —                   | `position`  | `integer` | preserves array order                               |

## Field mapping: `risks`

| TS field (`Risk`) | Column       | Type      | Notes                                         |
| ------------------ | ------------ | --------- | ----------------------------------------------- |
| `id`                | `id`         | `text` PK |                                                 |
| —                   | `report_id`  | `text`    | FK → `reports(id)`, `on delete cascade`         |
| `client`            | `client`     | `text`    | free text, no FK (see design decisions)         |
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

## Field mapping: `clients`

| Source                      | Column | Type              | Notes                                  |
| ---------------------------- | ------ | ----------------- | --------------------------------------- |
| `lib/constants.ts FF_CLIENTS`| `id`   | `text` PK          | slug generated from the client name     |
| `lib/constants.ts FF_CLIENTS`| `name` | `text`, `unique`   | exact display string used throughout the UI |

## Cutover checklist

1. Implement `SupabaseReportsRepository` in `lib/data/`, satisfying the
   existing `ReportsRepository` interface (`getAll`/`getAllDaily`/`getById`/
   `upsert`/`update`) — UI code never changes, since it only ever calls
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
   import verbatim — see "Text ids" above).
4. Swap the single switch point: `getReportsRepository()` in
   `lib/data/index.ts` returns `SupabaseReportsRepository` instead of
   `LocalStorageReportsRepository`.
5. Post-cutover drift check: run `supabase gen types typescript` and diff
   the generated types against `lib/types.ts` / this document whenever
   either changes, to catch schema/type drift early.

See also `CLAUDE.md`: *"Any PR that changes `lib/types.ts` domain shapes
must add a `supabase/migrations/*.sql` delta and update the mapping tables
in this document."*
