-- Weekly Reports Dashboard -- WP0 delta: the role ladder.
--
-- This is pure INFRASTRUCTURE -- it adds two functions and changes NO
-- existing policy. Nothing in this migration alone grants anyone a new
-- capability: `is_admin()` (supabase/migrations/20260719000004_auth_ownership.sql)
-- stays the exact function every current admin-only policy
-- (`projects_update`/`projects_delete`, and now `team_members_insert`/
-- `_update`/`_delete` below) already calls, UNCHANGED. What this migration
-- lands is a finer-grained SUCCESSOR those policies can graduate to in a
-- LATER package (the plan's "RLS access flip", explicitly out of scope
-- here) -- a three-tier ladder (`member` < `pm` < `admin`) instead of
-- today's binary admin/not-admin, so a future policy can require "at least
-- pm" without requiring "exactly admin".
--
-- ROLE AUTHORITY LIVES IN THE JWT, NOT A TABLE (same posture as `is_admin()`
-- itself): `auth.jwt() -> 'app_metadata' ->> 'role'` is server-set only
-- (`auth.admin.updateUserById`, never user-editable like `user_metadata`),
-- so it's safe to trust inside an RLS policy or a STABLE SQL function.
-- `team_members.role` (added by the sibling migration,
-- 20260726000016_team_members.sql) is a completely separate thing -- a
-- DIRECTORY LABEL with no permission meaning at all. See that migration's
-- header comment and CLAUDE.md's "Role ladder and team directory" section
-- for the two-role-stores-can-drift risk this split creates, and why it's
-- accepted anyway (a directory needs to be editable by an admin without
-- touching anyone's actual account/JWT, and there is no in-app path to the
-- JWT at all -- see scripts/set-user-role.mjs).
--
-- Role assignment itself stays OUT-OF-BAND, same as `is_admin()`'s own
-- 'admin' role today: this app never holds a service-role key at runtime
-- (lib/server/reports-service.ts's header comment is explicit that it must
-- NEVER be handed one), so there is no in-app "make this person a pm"
-- button, by construction -- see scripts/set-user-role.mjs, which is the
-- ONLY way to set `app_metadata.role`, mirroring scripts/create-user.mjs's
-- existing service-role-key-in-.env.deploy-only convention.

-- =============================================================================
-- public.role_rank(text): the ladder itself, as a total order over a plain
-- rank integer. IMMUTABLE (a pure function of its single text argument, no
-- table/session state read at all) -- Postgres can safely constant-fold or
-- index against it, unlike is_admin()/has_role_at_least() below (both read
-- auth.jwt(), i.e. per-request session state, so neither can be IMMUTABLE).
--
-- CRITICAL invariant, stated in the CASE itself: an unrecognized role text
-- (a typo, a future/removed tier, NULL, or the empty string) falls through
-- every WHEN branch to the ELSE, which returns 1 -- the SAME rank as
-- 'member', the least-privileged tier. This must NEVER error and must
-- NEVER default to a HIGHER rank than 'member' -- "unknown role" and "the
-- account is a plain member" must be indistinguishable to every caller of
-- this function, or a malformed/unexpected app_metadata.role value would
-- silently escalate privilege instead of degrading it.
-- =============================================================================
create or replace function public.role_rank(role text) returns int
language sql
immutable
as $$
  select case role
    when 'admin' then 3
    when 'pm' then 2
    when 'member' then 1
    else 1  -- unknown/NULL/absent -> LEAST privilege, never an error, never higher than 'member'.
  end
$$;

comment on function public.role_rank(text) is
  'Total order over the role ladder (member=1, pm=2, admin=3). IMMUTABLE -- a pure function of its argument, no session/table state. Any unrecognized value (typo, future/removed tier, NULL, empty string) returns 1 (member''s rank) -- an unknown role degrades to the LEAST privilege, never errors, never escalates. Client mirror: lib/roles.ts''s roleRank().';

-- Defense-in-depth, same rationale (and same pattern) as is_admin()'s own
-- revoke/grant pair (supabase/migrations/20260719000004_auth_ownership.sql):
-- Supabase's baseline `alter default privileges in schema public grant
-- execute on functions to anon, authenticated, service_role` grants EXECUTE
-- to every role on every new function by default, as an EXPLICIT per-role
-- grant -- `revoke ... from public` alone does NOT touch that (PUBLIC is a
-- separate pseudo-role from anon/authenticated). role_rank() reveals
-- nothing sensitive about anyone (it's a pure function of its own text
-- argument, not a lookup), so this is defense-in-depth (narrower attack
-- surface), not closing a live leak -- anon simply has no legitimate reason
-- to call it directly.
revoke all on function public.role_rank(text) from public, anon;
grant execute on function public.role_rank(text) to authenticated;

-- =============================================================================
-- public.has_role_at_least(required text): the predicate a future policy
-- will call in place of is_admin() once the "RLS access flip" package
-- lands. STABLE (not IMMUTABLE) because it reads auth.jwt(), which varies
-- by CALLER within a single statement -- Postgres may still cache the
-- result across multiple invocations within one query/transaction (the
-- STABLE contract), matching is_admin()'s own volatility category exactly.
--
-- `coalesce(... , 'member')` mirrors role_rank()'s own unknown-degrades-to-
-- member posture at the JWT-read layer too: an app_metadata with no `role`
-- key at all (every account created before this package, and every
-- account whose role was never explicitly set) reads as 'member', not as
-- an error and not as a NULL that could compare oddly against `required`.
-- =============================================================================
create or replace function public.has_role_at_least(required text) returns boolean
language sql
stable
as $$
  select public.role_rank(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'member'))
         >= public.role_rank(required)
$$;

comment on function public.has_role_at_least(text) is
  'True iff the calling JWT''s app_metadata.role (absent -> ''member'') ranks >= role_rank(required) on the member(1) < pm(2) < admin(3) ladder. STABLE, not IMMUTABLE (reads auth.jwt(), which varies per caller). NOT YET CALLED BY ANY POLICY in this migration -- is_admin() stays the enforcement function for every existing admin-only policy (projects_update/_delete, team_members_insert/_update/_delete); this function is the successor a LATER package (the "RLS access flip") will graduate specific policies to, so they can require "at least pm" rather than "exactly admin". Client mirror: lib/roles.ts''s hasRoleAtLeast(). KNOWN STALENESS (same caveat as is_admin()''s own comment, supabase/migrations/20260719000004_auth_ownership.sql): a role change made via scripts/set-user-role.mjs only lands in this function''s view of the caller on their NEXT token refresh (<= 1h) -- signing out and back in clears it immediately.';

-- Same defense-in-depth rationale as role_rank() above -- this function
-- also reveals nothing sensitive beyond the caller's OWN role (which they
-- already know from their own JWT), but anon still has no legitimate
-- reason to call it, and every future policy that references it will be
-- `to authenticated` only (mirroring every existing policy in this schema).
revoke all on function public.has_role_at_least(text) from public, anon;
grant execute on function public.has_role_at_least(text) to authenticated;
