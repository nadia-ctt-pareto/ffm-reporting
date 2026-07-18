// Ported verbatim from design-source/original-dashboard.dc.html script block:
// ffCsvEscape (444), exportAllTasksCSV (635-643).
//
// Phase 4: generalized to AnyReport (`reportPeriodLabel` resolves "Week of
// ..." for weekly vs. a short date for daily) so the same builder serves
// both the dashboard's weekly-only CSV export and the daily list's
// daily-only CSV export. The "Week" column header became "Period" to stay
// accurate for both callers.

import type { AnyReport } from './types';
import { reportPeriodLabel } from './report-utils';

/** Line 444 */
export function csvEscape(v: unknown): string {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Lines 636-638 */
export function buildAllTasksCsv(reports: AnyReport[]): string {
  const rows: (string | number)[][] = [
    ['Report ID', 'Period', 'Prepared For', 'Prepared By', 'Report Status', 'Client', 'Task', 'Task Status', 'Deadline'],
  ];
  reports.forEach((r) => {
    r.tasks.forEach((t) => {
      rows.push([r.id, reportPeriodLabel(r), r.preparedFor, r.preparedBy, r.status, t.client, t.task, t.status, t.deadline]);
    });
  });
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

/** Lines 639-642 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
