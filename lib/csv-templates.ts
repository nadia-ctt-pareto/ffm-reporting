// Phase 5 (Settings): the CSV import contract Phase 6's parser will consume.
// One unified long-format layout for BOTH weekly and daily reports, one row
// per record component, discriminated by `row_type` -- deliberately mirrors
// the wide-table style `lib/csv.ts`'s `buildAllTasksCsv` already uses (same
// `csvEscape` dialect), so a human can open either file in a spreadsheet app
// and understand it immediately.
//
// `IMPORT_COLUMNS` is exported so Phase 6's parser imports it from here --
// the contract physically cannot drift between "what we tell people to
// upload" and "what we actually parse".

import { csvEscape } from './csv';

/**
 * Exact column order for both the weekly and daily import templates.
 * `report_key` is any string unique within the file (the importer always
 * generates fresh ids -- it never trusts an incoming id). Dates are ISO
 * `yyyy-mm-dd`; quoting follows `csvEscape` (lib/csv.ts).
 *
 * WP2: deliberately has NO `assignee_id`/`created_at` column -- this is a
 * locked download-template contract (see this file's own header comment),
 * and extending it was out of scope for WP2. Every task assembled by
 * `lib/import.ts`'s `parseImportCsv` starts unassigned (`assigneeId`
 * undefined); a PM assigns it afterward via the `/tasks` dialog or the
 * wizard. `createdAt` IS still stamped on import (to the import run's own
 * timestamp) even though there's no column for it -- see `buildTask`'s doc
 * comment (lib/import.ts) -- because that's an app-internal creation stamp,
 * not something a spreadsheet author would ever supply.
 */
export const IMPORT_COLUMNS = [
  'kind',
  'report_key',
  'row_type',
  'week_start',
  'week_end',
  'date',
  'status',
  'prepared_for',
  'prepared_by',
  'summary',
  'client',
  'item',
  'item_status',
  'deadline',
  'completed_at',
  'severity',
  'next_step',
  'win_stat',
  'win_label',
  'win_narrative',
  'calls',
  'emails',
  'escalations',
  'touchpoints_note',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** One CSV row, keyed by every `IMPORT_COLUMNS` entry (blank string for anything not relevant to that `row_type`). */
export type ImportRow = Record<ImportColumn, string>;

/** All-blank row scaffold -- callers only fill in the columns their `row_type` needs. */
function blankRow(): ImportRow {
  return IMPORT_COLUMNS.reduce((acc, col) => {
    acc[col] = '';
    return acc;
  }, {} as ImportRow);
}

function buildCsv(rows: ImportRow[]): string {
  const header = IMPORT_COLUMNS.join(',');
  const body = rows.map((row) => IMPORT_COLUMNS.map((col) => csvEscape(row[col])).join(','));
  return [header, ...body].join('\n');
}

/**
 * `row_type='report'` -- one per report. `kind` decides which period
 * columns are filled (weekly -> week_start/week_end, daily -> date; the
 * other stays blank, mirroring the SQL `reports_period_by_kind` CHECK
 * constraint) -- everything else is shared.
 */
function reportRow(
  kind: 'weekly' | 'daily',
  reportKey: string,
  period: { weekStart?: string; weekEnd?: string; date?: string },
  fields: {
    status: string;
    preparedFor: string;
    preparedBy: string;
    summary: string;
    winStat: string;
    winLabel: string;
    winNarrative: string;
    calls: string;
    emails: string;
    escalations: string;
    touchpointsNote: string;
  }
): ImportRow {
  return {
    ...blankRow(),
    kind,
    report_key: reportKey,
    row_type: 'report',
    week_start: period.weekStart ?? '',
    week_end: period.weekEnd ?? '',
    date: period.date ?? '',
    status: fields.status,
    prepared_for: fields.preparedFor,
    prepared_by: fields.preparedBy,
    summary: fields.summary,
    win_stat: fields.winStat,
    win_label: fields.winLabel,
    win_narrative: fields.winNarrative,
    calls: fields.calls,
    emails: fields.emails,
    escalations: fields.escalations,
    touchpoints_note: fields.touchpointsNote,
  };
}

/**
 * `row_type='task'` -- `item_status` is `Complete|In Progress|Blocked`;
 * `deadline`/`completed_at` are each ISO or blank. `completed_at` is
 * OPTIONAL: the app auto-stamps it the moment a task's status becomes
 * Complete through any other write path, so a CSV import may leave it
 * blank for a Complete task and simply not have a recorded completion
 * date yet (the Schedule view falls back to week-level inference in that
 * case) -- passing an explicit value is only for importing a task whose
 * real completion date is already known.
 */
function taskRow(
  kind: 'weekly' | 'daily',
  reportKey: string,
  client: string,
  item: string,
  itemStatus: string,
  deadline: string,
  completedAt: string = ''
): ImportRow {
  return { ...blankRow(), kind, report_key: reportKey, row_type: 'task', client, item, item_status: itemStatus, deadline, completed_at: completedAt };
}

/** `row_type='risk'` -- `severity` is `Blocked|At Risk`; `item` carries the risk description. */
function riskRow(kind: 'weekly' | 'daily', reportKey: string, client: string, item: string, severity: string, nextStep: string): ImportRow {
  return { ...blankRow(), kind, report_key: reportKey, row_type: 'risk', client, item, severity, next_step: nextStep };
}

/** `row_type='priority'` -- `item` carries the priority text. */
function priorityRow(kind: 'weekly' | 'daily', reportKey: string, item: string): ImportRow {
  return { ...blankRow(), kind, report_key: reportKey, row_type: 'priority', item };
}

/**
 * Downloadable example CSV for a weekly-report import, exercising all four
 * `row_type`s. Dates deliberately sit OUTSIDE the seeded 2026-07-13..17
 * range (`lib/seed.ts`'s `r7`/`d1`-`d5`) -- an earlier version of this
 * template collided with seed data (the daily template's date matched
 * seeded daily `d2`, making the documented download-template-then-import
 * happy path fail on a fresh install with a one-per-day collision). 2026-08
 * is otherwise unused by any seed report.
 */
export function buildWeeklyImportTemplateCsv(): string {
  const reportKey = 'W1';
  const rows: ImportRow[] = [
    reportRow(
      'weekly',
      reportKey,
      { weekStart: '2026-08-03', weekEnd: '2026-08-07' },
      {
        status: 'Final',
        preparedFor: 'Casey Okafor',
        preparedBy: 'Jordan Reyes',
        summary: 'Steady progress across all four clients; one open blocker with DryRoot pending a permit.',
        winStat: '3x',
        winLabel: 'faster turnaround on Helitech change orders',
        winNarrative: 'Streamlined the change-order approval flow, cutting average turnaround from 6 days to 2.',
        calls: '14',
        emails: '52',
        escalations: '1',
        touchpointsNote: 'Weekly check-in calls with all four clients; one escalation resolved same-day.',
      }
    ),
    taskRow('weekly', reportKey, 'Helitech Foundation & Waterproofing', 'Finalize Q3 change order', 'Complete', '2026-08-05', '2026-08-05'),
    taskRow('weekly', reportKey, 'DryRoot Waterproofing', 'Submit city permit application', 'Blocked', '2026-08-08'),
    riskRow('weekly', reportKey, 'DryRoot Waterproofing', 'Permit office backlog delaying groundwork start', 'Blocked', 'Escalate to city liaison Monday'),
    priorityRow('weekly', reportKey, 'Close out DryRoot permit blocker'),
  ];
  return buildCsv(rows);
}

/**
 * Downloadable example CSV for a daily-report import, exercising all four
 * `row_type`s (report, task, risk, priority). See the doc comment on
 * `buildWeeklyImportTemplateCsv` above -- dates likewise moved outside the
 * seeded range (this template's `date` used to collide with seeded daily
 * `d2`'s 2026-07-14).
 */
export function buildDailyImportTemplateCsv(): string {
  const reportKey = 'D1';
  const rows: ImportRow[] = [
    reportRow(
      'daily',
      reportKey,
      { date: '2026-08-04' },
      {
        status: 'Sent',
        preparedFor: 'Casey Okafor',
        preparedBy: 'Jordan Reyes',
        summary: 'Site visit at Summit Basement; two client calls; no new blockers today.',
        winStat: '1',
        winLabel: 'new referral from TerraFirm',
        winNarrative: 'TerraFirm’s facilities manager referred a neighboring property for a foundation assessment.',
        calls: '2',
        emails: '9',
        escalations: '0',
        touchpointsNote: 'Both calls were routine status check-ins.',
      }
    ),
    taskRow('daily', reportKey, 'Summit Basement Solutions', 'On-site waterproofing inspection', 'Complete', '2026-08-04', '2026-08-04'),
    taskRow('daily', reportKey, 'TerraFirm Foundation Repair', 'Draft assessment proposal for referral', 'In Progress', '2026-08-06'),
    riskRow(
      'daily',
      reportKey,
      'TerraFirm Foundation Repair',
      'Client has not yet delivered updated project photos and testimonials needed for the assessment.',
      'At Risk',
      'Follow up with the client by phone tomorrow morning.'
    ),
    priorityRow('daily', reportKey, 'Send Summit inspection report to client'),
  ];
  return buildCsv(rows);
}
