// Ported verbatim from design-source/original-dashboard.dc.html script block:
// ffCsvEscape (444), exportAllTasksCSV (635-643).
//
// Phase 4: generalized to AnyReport (`reportPeriodLabel` resolves "Week of
// ..." for weekly vs. a short date for daily) so the same builder serves
// both the dashboard's weekly-only CSV export and the daily list's
// daily-only CSV export. The "Week" column header became "Period" to stay
// accurate for both callers.
//
// Phase 6b: `parseCsv` is the inverse of `csvEscape` below -- a hand-rolled
// RFC-4180-subset parser (not a dependency: PapaParse would be the standard
// answer, but the dialect here is fully self-controlled -- quotes only ever
// escape a field containing `,`/`\n`/`"`, and a doubled `""` inside a quoted
// field is a literal `"` -- and the repo's ethos is dependency-light,
// see lib/import.ts's header comment). Powers lib/import.ts's CSV importer.

import type { AnyReport } from './types';
import { reportPeriodLabel } from './report-utils';

/**
 * Line 444. Phase 6b: also neutralizes CSV/spreadsheet formula injection --
 * a leading `=`/`+`/`-`/`@`/tab/CR is a formula trigger in Excel/Sheets even
 * inside a QUOTED field (quoting alone does not stop it), so any such value
 * gets a literal-text `'` prefix before the normal quoting decision. This
 * matters starting Phase 6b specifically: it's the first phase where cell
 * content can originate outside the user's own keyboard (an imported CSV,
 * possibly LLM-authored per the Settings prompt library) and then round-trip
 * back OUT through `buildAllTasksCsv`/the template builders below into a
 * file someone opens in Excel.
 */
export function csvEscape(v: unknown): string {
  const raw = String(v === null || v === undefined ? '' : v);
  const s = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  // `\r` is included here (not just `,`/`\n`) so a field containing a bare
  // carriage return is quoted rather than exported unquoted -- parseCsv
  // below treats an unquoted `\r` as a row break, so leaving it unquoted
  // would silently split one exported row into two on re-import.
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Hand-rolled RFC-4180-subset CSV parser: a character-by-character state
 * machine (an `inQuotes` flag) that is the exact inverse of `csvEscape`
 * above. Handles the realities of a human uploading a spreadsheet export:
 *
 * - Doubled `""` inside a quoted field is a literal `"` (never ends the
 *   quoted run).
 * - A comma or newline INSIDE a quoted field is literal content, not a
 *   field/row separator -- embedded newlines are preserved verbatim.
 * - `\r\n` and bare `\r` line endings OUTSIDE quotes are both normalized to
 *   a row break (Excel exports use `\r\n`).
 * - A leading UTF-8 BOM (`﻿`, left behind by some `FileReader`/Excel
 *   exports) is stripped before parsing.
 * - A trailing blank line (the file ends with a row break and nothing after
 *   it, or ends with exactly two row breaks in a row) is ignored rather than
 *   producing a spurious final row of one empty field -- a real data row in
 *   this app's fixed 23-column contract (`IMPORT_COLUMNS`,
 *   lib/csv-templates.ts) can never itself be a single empty field. Note
 *   this only ever strips the very LAST row: three-or-more consecutive
 *   trailing row breaks leave one harmless stray `['']` row before it,
 *   which `lib/import.ts`'s own blank-row skip (`cells.every(c => c === '')`)
 *   silently drops during import regardless.
 *
 * The non-negotiable correctness gate (see scratchpad verification, not
 * shipped as an automated test -- this repo has no test runner): every row
 * of `parseCsv(buildWeeklyImportTemplateCsv())` and the daily template's
 * equivalent round-trips back to its source `ImportRow`, including the
 * templates' curly-quote content and any field containing a comma.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Final pending field/row, unless the file ended exactly on a row break
  // (nothing pending at all) -- avoids a spurious trailing empty row.
  if (field !== '' || row.length > 0) endRow();

  // A trailing blank line (a row break immediately followed by EOF, or by a
  // second row break) parses as one lone empty-string field -- ignore it,
  // per the doc comment above.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
  }

  return rows;
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
