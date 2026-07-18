-- Weekly Reports Dashboard -- Phase 4 delta: daily reports.
--
-- Adds the daily-report shape to the existing `reports` table (one unified
-- table for both kinds, mirroring the TS discriminated union
-- `AnyReport = WeeklyReport | DailyReport`, see lib/types.ts) rather than a
-- second `daily_reports` table -- `tasks`/`risks`/`priorities` already FK to
-- `reports(id)` and are identical in shape for both kinds, so a second table
-- would just duplicate every child-table FK and every read/write query path.
--
-- See docs/database-schema.md for the updated field-mapping table and the
-- discriminated-union <-> single-table rationale in full.

-- ---------------------------------------------------------------------------
-- reports: add kind/report_date, relax week_start/week_end to nullable,
-- and enforce "exactly one period, matching kind" + "one daily per day".
-- ---------------------------------------------------------------------------

alter table reports add column kind text not null default 'weekly' check (kind in ('weekly', 'daily'));
alter table reports add column report_date date;

-- Existing rows are all weekly (this migration runs after the baseline
-- schema, before any daily rows exist) -- week_start/week_end stay NOT NULL
-- for them by construction. Relaxing the column-level NOT NULL here is what
-- lets a daily row omit them; the CHECK constraint below is what actually
-- enforces "weekly rows still require week_start/week_end", not this ALTER.
alter table reports alter column week_start drop not null;
alter table reports alter column week_end drop not null;

alter table reports add constraint reports_period_by_kind check (
  (kind = 'weekly' and week_start is not null and week_end is not null and report_date is null) or
  (kind = 'daily' and report_date is not null and week_start is null and week_end is null)
);

comment on column reports.kind is 'Discriminant for the AnyReport union (lib/types.ts): ''weekly'' or ''daily''. A daily report is one per day, covering all clients (not per-client).';
comment on column reports.report_date is 'DailyReport[''date'']. NULL for weekly rows -- see reports_period_by_kind.';

-- One daily report per day, covering all clients -- enforced here as the
-- source of truth (a partial unique index only applies to kind = 'daily'
-- rows, so weekly rows' NULL report_date never collides with it). Mirrored
-- in the app at the wizard layer (StepBasics/validateStep +
-- dailyDateConflict, lib/report-utils.ts) so users get an inline error
-- instead of a raw constraint-violation on save.
create unique index reports_one_daily_per_day on reports (report_date) where kind = 'daily';

-- Daily list screen's default sort (newest first) and the weekly wizard's
-- "this week's daily reports" lookup both filter+sort by (kind, date/week_end)
-- together -- this index covers the weekly-report-list query path
-- (`reports_week_end_idx` from the baseline migration already covers plain
-- week_end lookups when kind isn't part of the predicate).
create index reports_kind_week_end on reports (kind, week_end desc);
create index reports_kind_report_date on reports (kind, report_date desc);
