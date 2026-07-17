// Ported verbatim from design-source/original-dashboard.dc.html script block,
// lines 416-427 (ffUid, ffParseISO, ffFmtDateShort, ffFmtWeekLabel, ffNowDate).
// Dates are ISO strings ('YYYY-MM-DD'); parsed manually (no Date-based
// timezone math) so comparisons stay stable regardless of local timezone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let uidCounter = 0;

/** Line 418 */
export function uid(prefix: string): string {
  uidCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + uidCounter;
}

export interface ParsedISODate {
  y: number;
  m: number;
  d: number;
}

/** Line 419 */
export function parseISO(s: string): ParsedISODate {
  const p = s.split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

/** Line 420 */
export function fmtDateShort(s: string): string {
  if (!s) return '—';
  const p = parseISO(s);
  return MONTHS[p.m - 1] + ' ' + p.d + ', ' + p.y;
}

/**
 * Line 421-426. NOTE the asymmetric dash spacing (ported faithfully):
 * same-month weeks use an en dash with NO spaces ("Jun 1–5, 2026");
 * cross-month weeks use a spaced en dash ("Jun 29 – Jul 3, 2026").
 */
export function fmtWeekLabel(startS: string, endS: string): string {
  if (!startS || !endS) return 'Week of —';
  const s = parseISO(startS);
  const e = parseISO(endS);
  if (s.m === e.m) {
    return 'Week of ' + MONTHS[s.m - 1] + ' ' + s.d + '–' + e.d + ', ' + e.y;
  }
  return 'Week of ' + MONTHS[s.m - 1] + ' ' + s.d + ' – ' + MONTHS[e.m - 1] + ' ' + e.d + ', ' + e.y;
}

/** Line 427. Kept as toISOString (UTC) for fidelity with the prototype. */
export function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}
