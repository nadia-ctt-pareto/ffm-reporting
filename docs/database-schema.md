# Database Schema — Weekly Reports Dashboard

Baseline schema for the eventual `SupabaseReportsRepository` (see
`lib/data/reports-repository.ts`). **No repository code reads/writes this
schema yet** — MVP persistence is still `LocalStorageReportsRepository`.
This document exists so the shape is reviewed and versioned ahead of the
cutover. The migration itself lives at
`supabase/migrations/20260717000001_initial_schema.sql`.

## Design decisions

- **Text ids, not `uuid`.** Existing localStorage data (`lib/seed.ts`, and
  anything already persisted in a browser under `ff.weekly-reports.v1`) uses
  ids like `"r1"` and `"t_abc123_4"` (see `lib/format.ts` `uid()`). Keeping
  every primary key as `text` lets that JSON import verbatim at cutover —
  zero id remapping.
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

| TS field (`Report`)         | Column                    | Type      | Notes                                    |
| ---------------------------- | ------------------------- | --------- | ----------------------------------------- |
| `id`                         | `id`                      | `text` PK |                                            |
| `weekStart`                  | `week_start`               | `date`    |                                            |
| `weekEnd`                    | `week_end`                 | `date`    | indexed `desc` (dashboard default sort)   |
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
   existing `ReportsRepository` interface (`getAll`/`getById`/`upsert`/
   `update`) — UI code never changes, since it only ever calls
   `getReportsRepository()` (`lib/data/index.ts`).
2. Map camelCase (TS) ↔ snake_case (SQL) per the field-mapping tables above.
   `getAll`/`getById` join `tasks`/`risks`/`priorities` (ordered by
   `position`) back into each `Report` object; `upsert`/`update` write the
   `reports` row plus replace its child rows (delete + reinsert by
   `report_id`, re-deriving `position` from array order, is the simplest
   correct strategy given these are small per-report lists).
3. One-time import: read every existing browser's `ff.weekly-reports.v1`
   localStorage payload and `upsert` each `Report` through the new
   repository (ids import verbatim — see "Text ids" above).
4. Swap the single switch point: `getReportsRepository()` in
   `lib/data/index.ts` returns `SupabaseReportsRepository` instead of
   `LocalStorageReportsRepository`.
5. Post-cutover drift check: run `supabase gen types typescript` and diff
   the generated types against `lib/types.ts` / this document whenever
   either changes, to catch schema/type drift early.

See also `CLAUDE.md`: *"Any PR that changes `lib/types.ts` domain shapes
must add a `supabase/migrations/*.sql` delta and update the mapping tables
in this document."*
