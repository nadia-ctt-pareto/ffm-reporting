/**
 * Phase 8d (report delete); WP3 (the access flip) added `canEditReport` beside it. The
 * predicates deciding whether the signed-in user may EDIT or DELETE a given
 * report. Call sites need this answer at the weekly and daily report screens
 * (`app/(shell)/reports/[id]/page.tsx`, `app/(shell)/daily/[id]/page.tsx`),
 * the weekly and daily list pages (`components/dashboard/DashboardPage.tsx`,
 * `components/daily/DailyPage.tsx`), and the wizard's resume/edit entry point
 * (`components/wizard/WizardPage.tsx`) -- hand-rolling an access rule at each
 * one is exactly the drift risk `resolveNewProjectName` (lib/projects.ts) was
 * extracted to avoid in Phase 8c.
 *
 * This is a UX gate, NOT the security boundary. The real control is the
 * `reports_update`/`reports_delete` RLS policies
 * (supabase/migrations/20260726000018_scoped_access.sql):
 *
 *     reports_update: using (owner_id = (select auth.uid()))
 *                     with check (owner_id = (select auth.uid()))
 *     reports_delete: using (owner_id = (select auth.uid()) or public.has_role_at_least('pm'))
 *
 * Postgres rejects a disallowed write no matter what this function returns.
 * What this function buys is honesty: CLAUDE.md's Phase 8c posture is that a
 * disabled control with an explanatory hint beats both a hidden control (the
 * feature becomes a mystery) and an enabled control that fails on click. That
 * only holds if these predicates and the RLS policies AGREE -- so the
 * conditions below are deliberately a 1:1 mirror of the SQL above, and
 * `hasRoleAtLeast` (lib/roles.ts) reads `app_metadata.role`, which is
 * precisely what `public.has_role_at_least()` inspects server-side.
 *
 * **WP3's actual flip, stated plainly**: `canDeleteReport` used to check
 * `app_metadata.role === 'admin'` (mirroring `reports_delete`'s old
 * `is_admin()` branch) -- it now checks `hasRoleAtLeast(user, 'pm')`
 * (mirroring `reports_delete`'s new `has_role_at_least('pm')` branch), so a
 * pm can now delete any report, not just an admin. `canEditReport` is BRAND
 * NEW and has NO role branch at all -- under the locked permission matrix,
 * editing a full report (the wizard's resume flow, this screen's own
 * inline-editable fields) is owner-only, even for a pm or an admin; their
 * only other write surface on someone else's report is the narrow assignee
 * task-patch RPC (`update_assigned_task`, see `lib/data/reports-repository.ts`'s
 * `updateTask`), which this module has nothing to do with.
 */

import type { User } from '@supabase/supabase-js';
import { hasRoleAtLeast } from './roles';
import type { AnyReport } from './types';

/** Shown next to a disabled Delete control. Kept here beside the predicate so the rule and its explanation can never drift apart. */
export const DELETE_REPORT_HINT = "Only the report's owner or a PM/admin can delete this report.";

/** Shown next to a disabled edit affordance (the wizard's "Continue"/"Edit Report" entry points, and ReportScreen's read-only inline fields). Kept here beside `canEditReport` so the rule and its explanation can never drift apart. */
export const EDIT_REPORT_HINT = "Only the report's owner can edit this report.";

export interface ReportAccessContext {
  /** The signed-in user, or `null` while the session is still resolving / when signed out. */
  user: User | null;
  /** `useSession().loading` -- true until the session has actually resolved. */
  loading: boolean;
  /** `isSupabaseConfigured()`. Demo mode has no auth concept at all. */
  supabaseConfigured: boolean;
}

/** Retained name for every existing call site (`canDeleteReport`'s own param type) -- identical shape to `ReportAccessContext`, see that type's doc comment. */
export type ReportDeleteAccess = ReportAccessContext;

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
  // while `public.has_role_at_least()` reads `auth.jwt() -> app_metadata`,
  // i.e. the TOKEN. supabase/migrations/20260726000015_role_ladder.sql
  // documents that a role change only lands in the token on refresh (up to
  // ~1h). So in the window just after someone is promoted to pm/admin, this
  // returns true while RLS still says no, and Delete is enabled but answers
  // "You don't have permission to do that." -- the one outcome this module
  // otherwise exists to prevent. Closing it would mean reading the decoded
  // JWT claim rather than the user record, which is a bigger change than the
  // window warrants for a handful of PMs at one agency; signing out and back
  // in clears it.
  //
  // WP3: this used to check `app_metadata.role === 'admin'` (mirroring
  // `reports_delete`'s old admin-only `is_admin()` branch) -- it now checks
  // `hasRoleAtLeast(user, 'pm')`, mirroring that policy's new
  // `has_role_at_least('pm')` branch (delete authority widened from
  // admin-only to pm-or-above; see the locked permission matrix in
  // supabase/migrations/20260726000018_scoped_access.sql's header comment).
  const isPmOrAbove = hasRoleAtLeast(access.user, 'pm');
  return isOwner || isPmOrAbove;
}

/**
 * WP3 (the access flip): the SINGLE predicate deciding whether the signed-in
 * user may EDIT (not delete) a given report -- the wizard's resume/"Continue"
 * affordance and the report screen's own inline-editable fields (status,
 * preparedFor, the period fields) both gate on this. Mirrors `reports_update`
 * RLS EXACTLY (supabase/migrations/20260726000018_scoped_access.sql):
 * owner-only, no pm/admin branch at all. This is the one place this module
 * diverges structurally from `canDeleteReport` -- editing a full report and
 * deleting one are NOT symmetric under the locked permission matrix (pm/admin
 * can delete anyone's report, but can only ever EDIT their own or an assigned
 * task's narrow fields).
 *
 * Same two traps `canDeleteReport` closes, closed identically here (see that
 * function's own doc comment): `Boolean(report.ownerId)` guards against
 * `undefined === undefined` silently reading as "owner" for an ownerless
 * report viewed by a not-yet-resolved/signed-out session, and `access.loading`
 * is checked before `report` so a still-resolving session never reads as
 * "editable" for a heartbeat before flipping to "not editable."
 */
export function canEditReport(report: AnyReport | null, access: ReportAccessContext): boolean {
  if (!access.supabaseConfigured) return true;
  if (access.loading || !report) return false;

  const userId = access.user?.id;
  if (!userId) return false;

  return Boolean(report.ownerId) && report.ownerId === userId;
}
