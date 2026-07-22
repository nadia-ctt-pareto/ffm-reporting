// WP0: the client-side mirror of supabase/migrations/20260726000015_role_ladder.sql's
// `role_rank`/`has_role_at_least`. Role AUTHORITY lives exclusively in the
// JWT's `app_metadata.role` -- server-set only (`auth.admin.updateUserById`
// via scripts/set-user-role.mjs, never user-editable like `user_metadata`),
// same trust posture `lib/report-access.ts`'s `canDeleteReport` already
// documents for `is_admin()`. This is deliberately NOT the same thing as
// `lib/schema/team.ts`'s `TeamMember.role` -- that column is a directory
// LABEL with no permission meaning at all (see that migration's header
// comment for the two-role-stores-can-drift risk); nothing in this file
// ever reads a `TeamMember`.
//
// **This is a UX gate, not the security boundary** -- exactly like
// `lib/report-access.ts`'s own header comment. The real control is
// `public.has_role_at_least()`/`public.is_admin()` (SQL, evaluated inside
// Postgres against the ACTUAL JWT on the wire), which any RLS policy that
// eventually adopts the ladder will call server-side; this module only
// decides what a UI control looks like (enabled vs. disabled-with-a-hint) --
// see CLAUDE.md's Phase 8c-established "disabled-with-a-hint over hidden"
// posture, which `hasRoleAtLeast` is meant to feed identically.
//
// KNOWN STALENESS WINDOW, stated exactly as `lib/report-access.ts` states it
// for `is_admin()` (the SAME underlying mechanism, so the SAME caveat
// applies verbatim): a role change made via `scripts/set-user-role.mjs`
// only lands in the affected user's JWT `app_metadata` on their NEXT token
// refresh (<= 1h per Supabase's own token-refresh cadence) -- until then,
// `hasRoleAtLeast` here (and `has_role_at_least()` in SQL) both keep
// reading the OLD role. This can point EITHER direction: a just-promoted
// user briefly still reads at their old (lower) rank here (a UX-only
// annoyance -- a control stays disabled a little longer than it should),
// while a just-DEMOTED user briefly still reads at their OLD (higher) rank
// (a real gap -- but one this module shares byte-for-byte with the SQL
// function a real RLS policy would enforce against, so a UI control built
// on this can never show MORE access than the server would actually honor
// once the request lands, only a stale ENABLED state for a control whose
// underlying request the server would already reject). Signing out and
// back in clears it immediately, same as `is_admin()`'s identical caveat.

import type { User } from '@supabase/supabase-js';

/** The three-tier ladder -- `member` < `pm` < `admin`. Mirrors the SQL CHECK on `role_rank`'s recognized inputs (and `team_members.role`'s CHECK, coincidentally the same three values for a completely different reason -- see this file's header comment). */
export type Role = 'member' | 'pm' | 'admin';

const RANK: Record<Role, number> = { member: 1, pm: 2, admin: 3 };

/**
 * Mirrors SQL `public.role_rank(text)` exactly, including its degrade-to-
 * least-privilege behavior: any value that isn't one of the three
 * recognized roles (a typo, a future/removed tier, `null`/`undefined`, an
 * empty string) returns `member`'s rank (1) -- NEVER throws, NEVER
 * resolves to a HIGHER rank than `member`. An unrecognized role must
 * degrade to the least-privileged tier, exactly like the SQL function's own
 * `CASE ... ELSE 1 END`.
 */
export function roleRank(role: string | null | undefined): number {
  if (role === 'member' || role === 'pm' || role === 'admin') return RANK[role];
  return RANK.member;
}

/**
 * Mirrors SQL `public.has_role_at_least(required)` exactly: reads
 * `user?.app_metadata?.role` (absent/unrecognized -> `'member'`, via
 * `roleRank`'s own coalesce-equivalent behavior above) and compares its
 * rank against `required`'s. `user` may be `null` (signed out, or the
 * session hasn't resolved yet) -- that reads as `member` too, same as an
 * absent `app_metadata.role`, which is the correct "no access" default for
 * every caller of this function (a still-loading session must never read
 * as MORE privileged than a resolved-but-unprivileged one -- see `lib/
 * report-access.ts`'s `canDeleteReport` for the identical "loading is not
 * access" principle applied to admin-gating).
 */
export function hasRoleAtLeast(user: User | null | undefined, required: Role): boolean {
  const role = user?.app_metadata?.role as string | undefined;
  return roleRank(role) >= roleRank(required);
}
