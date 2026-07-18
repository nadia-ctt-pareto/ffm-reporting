// Phase 3 (Calendar view) date math. Dates stay ISO strings ('YYYY-MM-DD')
// throughout the app (see CLAUDE.md "Conventions") -- every function here
// takes/returns ISO strings and does its arithmetic via `Date.UTC(y, m-1, d)`
// + `getUTCDay()`/`getUTCFullYear()`/`getUTCMonth()`/`getUTCDate()` ONLY.
// Never a local-time `new Date(isoString)` or local getters -- that would
// make the grid shift a day depending on the browser's timezone. "Today" is
// always sourced from the existing `nowDate()` (lib/format.ts), not `Date`
// directly.

import { fmtDateShort, parseISO } from './format';

const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Builds an ISO string from a UTC (y, m, d) triple, letting `Date.UTC`
 * normalize any overflow/underflow (`d = 32`, `m = 13`, `m = 0`, negative
 * `d`, ...) into the correct calendar date -- this is what makes
 * `addDaysISO`/`addMonthsISO` correct across month and year boundaries
 * without any manual carry logic.
 */
function toISO(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Adds `days` (may be negative) to an ISO date string. */
export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso);
  return toISO(y, m, d + days);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday (`Date#getUTCDay()` is 0 = Sunday ... 6 = Saturday). */
export function isoWeekday(iso: string): number {
  const { y, m, d } = parseISO(iso);
  const native = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return native === 0 ? 7 : native;
}

/** The Monday of the Mon–Sun week containing `iso` (seed weeks are always Mon–Fri, inside a Mon–Sun grid week). */
export function startOfWeekISO(iso: string): string {
  return addDaysISO(iso, -(isoWeekday(iso) - 1));
}

/** The Sunday of the Mon–Sun week containing `iso`. */
export function endOfWeekISO(iso: string): string {
  return addDaysISO(startOfWeekISO(iso), 6);
}

/** Shifts a Monday-anchored week start by `weeks` (may be negative). Pure day arithmetic -- always stays Monday-anchored. */
export function addWeeksISO(mondayISO: string, weeks: number): string {
  return addDaysISO(mondayISO, weeks * 7);
}

/** The 1st of the month containing `iso`. */
export function firstOfMonthISO(iso: string): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, 1);
}

/** Shifts a first-of-month anchor by `months` (may be negative), always landing back on the 1st (avoids day-of-month overflow across shorter months). */
export function addMonthsISO(firstOfMonthIso: string, months: number): string {
  const { y, m } = parseISO(firstOfMonthIso);
  return toISO(y, m + months, 1);
}

/**
 * Monday-start 6-row (42-day) grid of ISO date strings covering the month
 * containing `iso`, padded into the previous/next month so every row is a
 * full Mon–Sun week (a Mon–Fri seed week therefore always sits inside a
 * single row).
 */
export function monthGridDays(iso: string): string[] {
  const gridStart = startOfWeekISO(firstOfMonthISO(iso));
  return Array.from({ length: 42 }, (_, i) => addDaysISO(gridStart, i));
}

/** Whether `iso` falls in the same calendar month as `refIso`. */
export function isSameMonth(iso: string, refIso: string): boolean {
  const a = parseISO(iso);
  const b = parseISO(refIso);
  return a.y === b.y && a.m === b.m;
}

/** "July 2026" -- the Month view header label. */
export function monthLabel(iso: string): string {
  const { y, m } = parseISO(iso);
  return `${MONTHS_FULL[m - 1]} ${y}`;
}

/** "Jun 1" -- a compact day-cell label. Reuses `fmtDateShort` (never reimplements month-name formatting) and just drops the trailing ", YYYY". */
export function shortDayLabel(iso: string): string {
  return fmtDateShort(iso).split(',')[0];
}
