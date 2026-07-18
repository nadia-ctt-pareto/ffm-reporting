// Phase 6b: the CSV importer. Pure -- no storage, no React; the caller
// (components/settings/CsvImportSection.tsx) reads the uploaded file via
// `FileReader`, resolves/creates the target project, then calls
// `parseImportCsv` and only ever persists its `reports` if `issues` is
// empty (all-or-nothing -- see the doc comment on `ImportResult` below).
//
// Pipeline: (1) `parseCsv` (lib/csv.ts) turns the raw text into a string
// grid; (2) header validation against `IMPORT_COLUMNS`
// (lib/csv-templates.ts) -- name-exact but ORDER-INSENSITIVE (a spreadsheet
// user reordering columns must not break the import), missing/unknown
// columns each produce a row-1 issue; (3) every remaining row becomes an
// `ImportRow`-shaped record (blank string for any column the header didn't
// have); (4) per-`row_type` Zod validation (lib/schema/import.ts); (5)
// structural checks -- exactly one `report` row per `report_key`, every
// item row references an existing `report_key`, an item row's `kind` (if
// non-blank) matches its report row's, a weekly's `week_start <= week_end`,
// and the period columns present match `kind` (mirrors the SQL
// `reports_period_by_kind` CHECK); (6) daily one-per-day-per-project-bucket
// checks, both against `existing.dailies` and within the file itself (every
// imported report lands in the SAME project bucket this run -- see "One
// project per import run" below); (7) assemble `AnyReport`s -- every id is
// freshly generated (`report_key` only groups rows within this file and
// never survives import); (8) a belt-and-braces `AnyReportSchema.safeParse`
// on every assembled report (should never fail if 4-6 passed; if it
// somehow does, it becomes an issue, never a thrown exception).
//
// Issues are ACCUMULATED across the whole file, never first-error-abort,
// and import is all-or-nothing: any issue at all means `reports` is empty
// and nothing may be persisted. Header-row issues (missing/unknown columns)
// are themselves accumulated exactly like any other issue -- row processing
// still proceeds (using '' for any column the header was missing), so a
// single upload surfaces every problem in the file at once, not just the
// header's.
//
// "One project per import run" (decisive, see CLAUDE.md-style plan doc):
// every report assembled by ONE `parseImportCsv` call gets the SAME
// `projectId` (`targetProjectId`, resolved by the caller BEFORE parsing --
// either an existing project's id, a freshly `upsertProject`-created one, or
// `null` for "no project / house reports"). A file mixing multiple source
// projects is out of scope -- run the import twice.

import { parseCsv } from './csv';
import type { ImportColumn } from './csv-templates';
import { IMPORT_COLUMNS } from './csv-templates';
import { nowDate, uid } from './format';
import { projectIdForClientName } from './projects';
import { sameProjectBucket } from './report-utils';
import { AnyReportSchema } from './schema';
import {
  ImportPriorityRowSchema,
  ImportReportRowSchema,
  ImportRiskRowSchema,
  ImportRowTypeSchema,
  ImportTaskRowSchema,
} from './schema/import';
import type { AnyReport, DailyReport, Priority, Project, ReportCore, Risk, Task } from './types';

export interface ImportIssue {
  /** 1-based, INCLUDING the header row (so "row 1" always means the header, matching what a user sees in a spreadsheet app's row gutter). */
  row: number;
  column?: ImportColumn;
  message: string;
}

/**
 * `reports` is empty whenever `issues` is non-empty (all-or-nothing, see
 * this file's header comment) -- callers should never need to check both.
 */
export interface ImportResult {
  reports: AnyReport[];
  issues: ImportIssue[];
}

type RawRow = Record<ImportColumn, string>;

type ReportRowData = ReturnType<typeof ImportReportRowSchema.parse>;
type TaskRowData = ReturnType<typeof ImportTaskRowSchema.parse>;
type RiskRowData = ReturnType<typeof ImportRiskRowSchema.parse>;
type PriorityRowData = ReturnType<typeof ImportPriorityRowSchema.parse>;

interface ParsedReportRow {
  rowNumber: number;
  reportKey: string;
  kind: 'weekly' | 'daily';
  data: ReportRowData;
}
interface ParsedItemRow<T> {
  rowNumber: number;
  reportKey: string;
  kind: '' | 'weekly' | 'daily';
  data: T;
}

/** Caps a piece of file-derived content embedded in an issue message, so a pathological huge cell value (an oversized single field) can never bloat the rendered issue list. Fixed IMPORT_COLUMNS-derived strings (column names) are never passed through this -- only content that actually came from the uploaded file. */
function truncateForMessage(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildHeaderIndex(header: string[]): { index: Partial<Record<ImportColumn, number>>; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const index: Partial<Record<ImportColumn, number>> = {};

  for (const col of IMPORT_COLUMNS) {
    const positions = header.reduce<number[]>((acc, name, i) => (name === col ? [...acc, i] : acc), []);
    if (positions.length === 0) {
      issues.push({ row: 1, column: col, message: `Missing required column "${col}".` });
    } else {
      if (positions.length > 1) {
        issues.push({ row: 1, column: col, message: `Column "${col}" appears more than once in the header (columns ${positions.map((p) => p + 1).join(', ')}).` });
      }
      index[col] = positions[0];
    }
  }
  // Unrecognized columns (e.g. a stray "Notes" column a user added while
  // editing the template in a spreadsheet) are genuinely IGNORED, not
  // flagged -- `toRawRow` below only ever reads the known IMPORT_COLUMNS
  // names by position, so an extra column can never affect parsing. Import
  // is all-or-nothing, so flagging a harmless extra column would hard-fail
  // an otherwise-valid file for no reason.
  return { index, issues };
}

function toRawRow(cells: string[], index: Partial<Record<ImportColumn, number>>): RawRow {
  const row = {} as RawRow;
  for (const col of IMPORT_COLUMNS) {
    const at = index[col];
    row[col] = at !== undefined ? (cells[at] ?? '') : '';
  }
  return row;
}

function issuesFromZod<T>(
  result: { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  rowNumber: number
): ImportIssue[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    row: rowNumber,
    column: typeof issue.path[0] === 'string' ? (issue.path[0] as ImportColumn) : undefined,
    message: issue.message,
  }));
}

function buildTask(row: ParsedItemRow<TaskRowData>, projects: Project[]): Task {
  return {
    id: uid('t'),
    client: row.data.client,
    projectId: projectIdForClientName(row.data.client, projects),
    task: row.data.item,
    status: row.data.item_status,
    deadline: row.data.deadline,
  };
}

function buildRisk(row: ParsedItemRow<RiskRowData>, projects: Project[]): Risk {
  return {
    id: uid('rk'),
    client: row.data.client,
    projectId: projectIdForClientName(row.data.client, projects),
    severity: row.data.severity,
    description: row.data.item,
    nextStep: row.data.next_step,
  };
}

function buildPriority(row: ParsedItemRow<PriorityRowData>): Priority {
  return { id: uid('p'), text: row.data.item };
}

/**
 * Parses an uploaded CSV (the `IMPORT_COLUMNS` long-format contract, see
 * lib/csv-templates.ts) into `AnyReport[]`, stamping every assembled
 * report's `projectId` with `targetProjectId` -- `null` for "no project /
 * house reports". `existing.dailies` is every daily report already in the
 * store (across every project bucket), used for the one-per-day-per-bucket
 * check (step 6); `existing.projects` is every known project, used to stamp
 * each assembled task/risk's OWN `projectId` via an exact `client === name`
 * match (`projectIdForClientName`, lib/projects.ts) -- independent of
 * `targetProjectId`, exactly like `ensureProjectIds`' lazy backfill already
 * does for hand-authored reports (a task whose `client` string happens to
 * match a DIFFERENT project than the one this file is being imported into
 * still gets that task-level metadata stamped; this is today's existing
 * semantics, not new to the importer).
 */
export function parseImportCsv(
  text: string,
  targetProjectId: string | null,
  existing: { dailies: DailyReport[]; projects: Project[] }
): ImportResult {
  const issues: ImportIssue[] = [];
  const table = parseCsv(text);

  if (table.length === 0) {
    return { reports: [], issues: [{ row: 1, message: 'The file is empty.' }] };
  }

  const [header, ...bodyRows] = table;
  const { index, issues: headerIssues } = buildHeaderIndex(header);
  issues.push(...headerIssues);

  const reportRows: ParsedReportRow[] = [];
  const taskRows: ParsedItemRow<TaskRowData>[] = [];
  const riskRows: ParsedItemRow<RiskRowData>[] = [];
  const priorityRows: ParsedItemRow<PriorityRowData>[] = [];

  bodyRows.forEach((cells, i) => {
    if (cells.every((c) => c === '')) return; // a genuinely blank line -- skip silently
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const raw = toRawRow(cells, index);

    const rowTypeResult = ImportRowTypeSchema.safeParse(raw.row_type);
    if (!rowTypeResult.success) {
      issues.push({ row: rowNumber, column: 'row_type', message: `Unknown row_type "${truncateForMessage(raw.row_type)}".` });
      return;
    }

    if (rowTypeResult.data === 'report') {
      const result = ImportReportRowSchema.safeParse(raw);
      issues.push(...issuesFromZod(result, rowNumber));
      if (result.success) reportRows.push({ rowNumber, reportKey: raw.report_key, kind: result.data.kind, data: result.data });
      return;
    }
    if (rowTypeResult.data === 'task') {
      const result = ImportTaskRowSchema.safeParse(raw);
      issues.push(...issuesFromZod(result, rowNumber));
      if (result.success) taskRows.push({ rowNumber, reportKey: raw.report_key, kind: result.data.kind, data: result.data });
      return;
    }
    if (rowTypeResult.data === 'risk') {
      const result = ImportRiskRowSchema.safeParse(raw);
      issues.push(...issuesFromZod(result, rowNumber));
      if (result.success) riskRows.push({ rowNumber, reportKey: raw.report_key, kind: result.data.kind, data: result.data });
      return;
    }
    // 'priority'
    const result = ImportPriorityRowSchema.safeParse(raw);
    issues.push(...issuesFromZod(result, rowNumber));
    if (result.success) priorityRows.push({ rowNumber, reportKey: raw.report_key, kind: result.data.kind, data: result.data });
  });

  // ---- structural checks (step 5) ----
  const reportByKey = new Map<string, ParsedReportRow>();
  for (const r of reportRows) {
    const existingRow = reportByKey.get(r.reportKey);
    if (existingRow) {
      issues.push({
        row: r.rowNumber,
        column: 'report_key',
        message: `Duplicate report_key "${truncateForMessage(r.reportKey)}" (first seen on row ${existingRow.rowNumber}).`,
      });
      continue;
    }
    reportByKey.set(r.reportKey, r);
  }

  for (const r of reportRows) {
    if (r.kind === 'weekly') {
      if (!r.data.week_start || !r.data.week_end) {
        issues.push({ row: r.rowNumber, message: 'A weekly report row must have both week_start and week_end set.' });
      } else if (r.data.week_start.localeCompare(r.data.week_end) > 0) {
        issues.push({ row: r.rowNumber, message: 'week_start must be on or before week_end.' });
      }
      if (r.data.date) issues.push({ row: r.rowNumber, column: 'date', message: 'A weekly report row must leave date blank.' });
    } else {
      if (!r.data.date) issues.push({ row: r.rowNumber, column: 'date', message: 'A daily report row must have date set.' });
      if (r.data.week_start || r.data.week_end) {
        issues.push({ row: r.rowNumber, message: 'A daily report row must leave week_start and week_end blank.' });
      }
    }
  }

  function checkItemRow(row: ParsedItemRow<unknown>): void {
    const parent = reportByKey.get(row.reportKey);
    if (!parent) {
      issues.push({
        row: row.rowNumber,
        column: 'report_key',
        message: `References report_key "${truncateForMessage(row.reportKey)}", which has no matching report row.`,
      });
      return;
    }
    if (row.kind && row.kind !== parent.kind) {
      issues.push({
        row: row.rowNumber,
        column: 'kind',
        message: `Row's kind "${row.kind}" does not match report "${truncateForMessage(row.reportKey)}"'s kind "${parent.kind}".`,
      });
    }
  }
  taskRows.forEach(checkItemRow);
  riskRows.forEach(checkItemRow);
  priorityRows.forEach(checkItemRow);

  // ---- daily one-per-day-per-project-bucket (step 6) ----
  const dailyReportRows = reportRows.filter((r) => r.kind === 'daily');
  const seenDailyDates = new Map<string, number>();
  for (const r of dailyReportRows) {
    const date = r.data.date;
    if (!date) continue; // already flagged above ("A daily report row must have date set") -- don't ALSO emit a spurious "duplicate ''" collision for every blank-date row
    const firstRow = seenDailyDates.get(date);
    if (firstRow !== undefined) {
      issues.push({
        row: r.rowNumber,
        column: 'date',
        message: `Duplicate daily report date "${date}" within this file (also on row ${firstRow}).`,
      });
    } else {
      seenDailyDates.set(date, r.rowNumber);
    }
    const collidesWithExisting = existing.dailies.some((d) => d.date === date && sameProjectBucket(d.projectId, targetProjectId));
    if (collidesWithExisting) {
      issues.push({ row: r.rowNumber, column: 'date', message: `A daily report for "${date}" already exists in this project.` });
    }
  }

  if (issues.length > 0) return { reports: [], issues };

  // ---- assemble (step 7) ----
  // Group item rows by report_key ONCE (not a `.filter()` re-scan per report
  // row) -- a `.filter()` inside `.map()` here would be O(reports × items),
  // quadratic in the file's total row count.
  function groupByReportKey<T extends { reportKey: string }>(rows: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.reportKey);
      if (list) list.push(row);
      else map.set(row.reportKey, [row]);
    }
    return map;
  }
  const taskRowsByReport = groupByReportKey(taskRows);
  const riskRowsByReport = groupByReportKey(riskRows);
  const priorityRowsByReport = groupByReportKey(priorityRows);

  const now = nowDate();
  const reports: AnyReport[] = reportRows.map((r) => {
    const tasks = (taskRowsByReport.get(r.reportKey) ?? []).map((t) => buildTask(t, existing.projects));
    const risks = (riskRowsByReport.get(r.reportKey) ?? []).map((rk) => buildRisk(rk, existing.projects));
    const priorities = (priorityRowsByReport.get(r.reportKey) ?? []).map((p) => buildPriority(p));

    const core: ReportCore = {
      id: uid(r.kind === 'daily' ? 'd' : 'r'),
      status: r.data.status,
      preparedFor: r.data.prepared_for,
      preparedBy: r.data.prepared_by,
      createdAt: now,
      updatedAt: now,
      summaryNarrative: r.data.summary,
      tasks,
      risks,
      win: { stat: r.data.win_stat, label: r.data.win_label, narrative: r.data.win_narrative },
      touchpoints: {
        calls: Number(r.data.calls || '0'),
        emails: Number(r.data.emails || '0'),
        escalations: Number(r.data.escalations || '0'),
        narrative: r.data.touchpoints_note,
      },
      priorities,
      projectId: targetProjectId,
    };

    return r.kind === 'daily'
      ? { ...core, kind: 'daily', date: r.data.date }
      : { ...core, kind: 'weekly', weekStart: r.data.week_start, weekEnd: r.data.week_end };
  });

  // ---- belt-and-braces (step 8) ----
  const assembledIssues: ImportIssue[] = [];
  reports.forEach((report, i) => {
    const result = AnyReportSchema.safeParse(report);
    if (!result.success) {
      const rowNumber = reportRows[i]?.rowNumber ?? 1;
      for (const issue of result.error.issues) {
        assembledIssues.push({ row: rowNumber, message: `Internal validation failed: ${issue.message}` });
      }
    }
  });
  if (assembledIssues.length > 0) return { reports: [], issues: assembledIssues };

  return { reports, issues: [] };
}
