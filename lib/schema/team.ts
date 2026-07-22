// WP1: the TeamMember entity. Matches the SQL `team_members` table exactly
// (supabase/migrations/20260726000016_team_members.sql). Mirrors `lib/
// schema/project.ts`'s minimal-shape convention -- one shape covers both
// read and write here (unlike `lib/schema/report.ts`'s separate permissive-
// read/bounded-write split), because, like `Project`, a `TeamMember` is
// small and entirely admin-authored; there's no untrusted bulk-import path
// (CSV, MCP) that needs a looser read shape the way reports do.
//
// `role` is a DIRECTORY LABEL ONLY -- see the sibling migration's header
// comment and CLAUDE.md's "Role ladder and team directory" section. It
// carries NO permission meaning; permission authority lives exclusively in
// the JWT `app_metadata.role` read by `lib/roles.ts` / SQL's
// `has_role_at_least()`/`is_admin()`. Do not wire this field into any
// access-control decision anywhere in this codebase.

import { z } from 'zod';

/** Mirrors the SQL CHECK on `team_members.role` (and, coincidentally, the same three literal values `lib/roles.ts`'s `Role` type uses for a completely unrelated reason -- see this file's header comment for why the two must never be confused). */
export const TeamMemberRoleSchema = z.enum(['member', 'pm', 'admin']);
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

export const TeamMemberSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  role: TeamMemberRoleSchema,
  /**
   * Admin-recorded, independent of the linked `auth.users.email` if any
   * (see the migration's header comment on the accepted drift risk this
   * creates, and why). `.email()` is a shape check only -- the real
   * verification is `public.link_my_team_member()`'s own case-insensitive
   * match against the CALLER's actual, Supabase-verified account email;
   * this field is inert metadata until that match happens. `.nullish()`
   * (not every directory row has an email yet).
   */
  email: z.string().email().max(320).nullish(),
  /**
   * `auth.users` id, once linked via `public.link_my_team_member()`. Never
   * set by any app write path other than that one SECURITY DEFINER RPC --
   * `ensureTeamMember`/`renameTeamMember` (lib/server/reports-service.ts)
   * never include this field in an INSERT/UPDATE payload, mirroring
   * `ReportCoreSchema.ownerId`'s identical "server-stamped, client never
   * sends it" posture (lib/schema/report.ts). `.nullish()` (unlinked is the
   * default, and permanent for a directory entry with no account at all).
   */
  userId: z.string().nullish(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;
