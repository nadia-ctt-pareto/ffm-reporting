/**
 * Phase 8d (report delete): the SINGLE predicate deciding whether the signed-in user may
 * delete a given report. Four call sites need this answer -- the weekly and
 * daily report screens (`app/(shell)/reports/[id]/page.tsx`,
 * `app/(shell)/daily/[id]/page.tsx`) and the weekly and daily list pages
 * (`components/dashboard/DashboardPage.tsx`, `components/daily/DailyPage.tsx`)
 * -- and four hand-rolled copies of an access rule is exactly the drift risk
 * `resolveNewProjectName` (lib/projects.ts) was extracted to avoid in Phase 8c.
 *
 * This is a UX gate, NOT the security boundary. The real control is the
 * `reports_delete` RLS policy (supabase/migrations/20260719000004_auth_ownership.sql):
 *
 *     using (owner_id = (select auth.uid()) or public.is_admin())
 *
 * Postgres rejects a non-owner's delete no matter what this function returns.
 * What this function buys is honesty: CLAUDE.md's Phase 8c posture is that a
 * disabled control with an explanatory hint beats both a hidden control (the
 * feature becomes a mystery) and an enabled control that fails on click. That
 * only holds if this predicate and the RLS policy AGREE -- so the two
 * conditions below are deliberately a 1:1 mirror of the SQL above, and
 * `isAdmin` reads `app_metadata.role`, which is precisely what
 * `public.is_admin()` inspects server-side.
 */

import type { User } from '@supabase/supabase-js';
import type { AnyReport } from './types';

/** Shown next to a disabled Delete control. Kept here beside the predicate so the rule and its explanation can never drift apart. */
export const DELETE_REPORT_HINT = "Only the report's owner or an admin can delete this report.";

export interface ReportDeleteAccess {
  /** The signed-in user, or `null` while the session is still resolving / when signed out. */
  user: User | null;
  /** `useSession().loading` -- true until the session has actually resolved. */
  loading: boolean;
  /** `isSupabaseConfigured()`. Demo mode has no auth concept at all. */
  supabaseConfigured: boolean;
}

/**
 * Two traps this closes, both of which the naive inline expression
 * (`report?.ownerId === user?.id || user?.app_metadata?.role === 'admin'`)
 * fell into:
 *
 * 1. **`undefined === undefined` is `true`.** `db-mapping.ts` maps a NULL
 *    `owner_id` to `undefined` (seed/system rows have no owner), and
 *    `user?.id` is `undefined` whenever `user` is null. So an unowned report
 *    viewed by a not-yet-resolved (or signed-out) session compared
 *    `undefined === undefined` and enabled Delete for someone who cannot
 *    delete. The explicit `Boolean(user?.id)` guard below is what makes the
 *    ownership test require a REAL id on both sides -- matching the SQL,
 *    where `owner_id = auth.uid()` is NULL-safe by SQL's own three-valued
 *    logic (NULL = anything is NULL, never true).
 *
 * 2. **The session's loading state was never consulted.** `useSession` starts
 *    at `{ user: null, loading: true }`, so for the first frames of every
 *    page load the admin check is evaluated against a null user. Treating
 *    "still loading" as "no access" makes the control settle from disabled to
 *    enabled (a control that becomes available), never from enabled to
 *    disabled (a control that is snatched away mid-reach).
 *
 * Demo mode short-circuits to `true`: with no Supabase env there is no auth,
 * no session and no RLS -- the data is this browser's own localStorage. Full
 * access to your own local data is the sensible default, and it is the same
 * posture `ProjectDetailScreen` already documents for `isAdmin` in demo mode.
 */
export function canDeleteReport(report: AnyReport | null, access: ReportDeleteAccess): boolean {
  if (!access.supabaseConfigured) return true;
  if (access.loading || !report) return false;

  const userId = access.user?.id;
  if (!userId) return false;

  const isOwner = Boolean(report.ownerId) && report.ownerId === userId;
  // KNOWN STALENESS WINDOW (surfaced by security review; fails CLOSED, so it
  // is a UX-honesty wrinkle, not a boundary hole). `useSession` reads
  // `supabase.auth.getUser()`, which reflects the SERVER-side user record,
  // while `public.is_admin()` reads `auth.jwt() -> app_metadata`, i.e. the
  // TOKEN. supabase/migrations/20260719000004_auth_ownership.sql documents
  // that a role change only lands in the token on refresh (up to ~1h). So in
  // the window just after someone is granted admin, this returns true while
  // RLS still says no, and Delete is enabled but answers "You don't have
  // permission to do that." -- the one outcome this module otherwise exists
  // to prevent. Closing it would mean reading the decoded JWT claim rather
  // than the user record, which is a bigger change than the window warrants
  // for a handful of PMs at one agency; signing out and back in clears it.
  const isAdmin = access.user?.app_metadata?.role === 'admin';
  return isOwner || isAdmin;
}
