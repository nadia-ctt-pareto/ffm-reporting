// Ported verbatim from design-source/original-dashboard.dc.html script block,
// lines 416-427 (ffUid, ffParseISO, ffFmtDateShort, ffFmtWeekLabel, ffNowDate).
// Dates are ISO strings ('YYYY-MM-DD'); parsed manually (no Date-based
// timezone math) so comparisons stay stable regardless of local timezone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Line 418. Phase 7a: deliberate departure from the prototype's counter-based
 * id (`Date.now().toString(36) + '_' + counter`) -- collision-prone the
 * moment two browser tabs (or, soon, two users) mint ids around the same
 * millisecond. `crypto.randomUUID()` is available in every modern browser
 * secure context (localhost qualifies) and Node 18+. Same signature, same
 * debuggable `prefix_` convention, zero call-site churn. Existing ids need
 * no remapping anywhere: the SQL PKs are `text` specifically so
 * `r1`...`r7`, `d1`...`d5`, project slugs, and legacy `t_xxx_4`-style ids
 * import verbatim (see docs/database-schema.md "Text ids, not uuid"). The
 * residual collision hazard is *seed ids colliding across users at import
 * time* (every browser's localStorage contains the same `r1`) -- closed by
 * the Phase 7b import path's `skip_existing` semantics (an id already
 * present in Postgres is skipped and reported, never overwritten), not by
 * this function.
 *
 * Post-review fix: `crypto.randomUUID()` is `[SecureContext]`-gated, not
 * universally available the way the original comment implied -- it's
 * `undefined` on a plain-HTTP origin that ISN'T `localhost` itself, e.g.
 * the LAN "Network" URL `next dev` prints (`http://192.168.x.x:3000`),
 * which worked fine pre-Phase-7a and is a real, documented way this app
 * gets used (testing on a phone/tablet on the same network). `uid()` fires
 * on every Add Task/Risk/Priority click plus the CSV importer and
 * consolidation -- all of which would otherwise throw
 * `TypeError: crypto.randomUUID is not a function` over LAN HTTP. Falls
 * back to the prototype's original counter-based scheme (still
 * collision-resistant enough for a single-tab fallback path; the
 * cross-tab/cross-user hazard this function's main comment already
 * documents as accepted is unchanged either way).
 */
let fallbackCounter = 0;

export function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix + '_' + crypto.randomUUID();
  }
  fallbackCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + fallbackCounter;
}

export interface ParsedISODate {
  y: number;
  m: number;
  d: number;
}

/**
 * Line 419. Post-review hardening (Phase 7a): takes only the first 10
 * characters before splitting -- a plain 'yyyy-mm-dd' string is unaffected
 * (slicing its own first 10 chars is a no-op), but this is what keeps a
 * full timestamptz string working too (e.g. what PostgREST returns for the
 * now-`timestamptz` `reports.created_at`/`updated_at`,
 * supabase/migrations/20260719000004_auth_ownership.sql --
 * `"2026-07-13T00:00:00+00:00"`). Without this, `s.split('-')` on that
 * string yields a bogus `{ d: NaN }` (the day segment is
 * `"13T00:00:00+00:00"`, and `Number(...)` of that is `NaN`), and
 * `fmtDateShort` below silently renders `"Jul NaN, 2026"` -- verified. This
 * is NOT a live 7a bug (no repository reads a Postgres row yet -- that's
 * Phase 7b), but landing the fix now, in the same phase that widened the
 * column type, is what keeps it from ever becoming one.
 */
export function parseISO(s: string): ParsedISODate {
  const p = s.slice(0, 10).split('-').map(Number);
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
