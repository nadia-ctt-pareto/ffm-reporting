-- Weekly Reports Dashboard -- WP1 delta: the team directory.
--
-- A new, standalone table -- `team_members` -- that lists the people at
-- Foundation First Marketing, independent of both (a) whether they have a
-- Supabase account at all, and (b) what that account's ROLE-LADDER
-- authority is. This is deliberately a DIRECTORY, not an access-control
-- table: a later package (task assignee fields) will FK a task's assignee
-- to `team_members.id`, and that needs a stable roster to point at even for
-- people who have never signed in (a new hire before their first login,
-- someone the agency wants to assign tasks to without ever giving them a
-- Weekly Reports account at all).
--
-- =============================================================================
-- WHY `team_members.role` IS NOT THE SAME THING AS app_metadata.role
-- =============================================================================
-- `team_members.role` is a plain, admin-editable text column -- purely a
-- directory LABEL, shown next to someone's name so a PM picking an
-- assignee (a later package) can see "Jordan Reyes (PM)" at a glance. It
-- carries **NO PERMISSION MEANING WHATSOEVER**. The actual enforcement
-- authority for what an account can DO lives exclusively in that account's
-- JWT `app_metadata.role` (supabase/migrations/20260726000015_role_ladder.sql's
-- `role_rank()`/`has_role_at_least()`, and `is_admin()` before it,
-- supabase/migrations/20260719000004_auth_ownership.sql) -- a value this
-- table cannot see, cannot set, and does not attempt to mirror.
--
-- **Risk, stated explicitly (two role stores that CAN drift):** an admin
-- could set a directory row's `role` to `'admin'` for someone whose actual
-- account JWT still says `'member'` (or has no linked account at all yet).
-- That row's `role` column would then be pure fiction with respect to what
-- that person can actually do in this app -- and this is ACCEPTED, not a
-- bug to fix here, because:
--   1. There is no way to avoid it without giving this table write access
--      to `auth.users.raw_app_meta_data`, which would mean either (a)
--      handing a service-role credential to the app at runtime (explicitly
--      forbidden everywhere in this codebase -- see lib/server/
--      reports-service.ts's header comment) or (b) a SECURITY DEFINER
--      function that lets an admin remotely mutate ANOTHER user's JWT
--      claims from inside a plain table write, which is a MUCH larger
--      privilege-escalation surface than a cosmetic label ever is.
--   2. The column's own comment (below) and the UI's persistent muted note
--      (`components/team/TeamManager.tsx`) both say this outright, so no
--      admin can be confused about what changing it does or doesn't do.
--   3. Nothing in this codebase (this package or any that came before it)
--      ever READS `team_members.role` to decide access. Grep protection: if
--      that ever changes, it is a bug in the NEW code, not in this table.
--
-- =============================================================================
-- ACCOUNT LINKING -- the design, and why it isn't a UUID paste box
-- =============================================================================
-- This app has no service-role key at runtime, so it cannot list
-- `auth.users` client-side -- an admin picker over real accounts ("link
-- this directory row to THAT account") is not buildable without one, and a
-- naive alternative -- a plain `user_id` text field an admin free-types --
-- would let anyone paste an arbitrary uuid and silently grant a directory
-- row (and, in a LATER package, whatever tasks get assigned through it) to
-- an account that has no actual connection to that person. A "this is me"
-- self-claim button on an unauthenticated/unverified basis has the
-- identical problem in the other direction: anyone signed in could claim
-- ANY unlinked row, including someone else's.
--
-- The design actually shipped: an admin records the person's `email` on the
-- directory row (a real column here, independent of `auth.users.email` --
-- see the two-role-stores-drift-risk section above; this is the SAME kind
-- of accepted, explicitly-documented drift risk, and is likewise mitigated
-- by the fact that nothing sensitive turns on this email alone -- it is
-- inert metadata until `link_my_team_member()` below actually matches it
-- against a VERIFIED `auth.users.email`). `public.link_my_team_member()` is
-- a SECURITY DEFINER RPC that links the CALLER ONLY: it sets
-- `team_members.user_id = auth.uid()` for the single row whose `email`
-- (case-insensitively) matches `auth.uid()`'s OWN `auth.users.email` --
-- never anyone else's, and never a row that's already linked (`user_id is
-- null` is part of the WHERE clause, which is also what makes repeated
-- calls a safe no-op -- see that function's own comment). It is called
-- once, quietly, after sign-in (`components/app/AppShell.tsx`) -- a
-- convenience, not a gate: nothing in THIS package depends on the link
-- existing yet.

create table team_members (
  id text primary key,
  name text not null unique,
  -- Directory label ONLY -- see this migration's header comment. The CHECK
  -- mirrors role_rank()'s own three tiers so a directory row can never
  -- claim a role that doesn't exist on the ladder, even though this column
  -- has no bearing on what that ladder actually grants.
  role text not null default 'member' check (role in ('member', 'pm', 'admin')),
  -- Independent of auth.users.email (see the header comment's "two role
  -- stores can drift" framing, applied identically to email: this is
  -- inert directory metadata until link_my_team_member() below matches it
  -- against a VERIFIED account email). `unique` so two directory rows can
  -- never race to link the same account.
  email text unique,
  -- Set ONLY by link_my_team_member() below (SECURITY DEFINER, self-link
  -- only) -- never directly writable by any app write path, even an
  -- admin's (see reports-service.ts's ensureTeamMember/renameTeamMember,
  -- neither of which ever includes this column in an INSERT/UPDATE
  -- payload). `unique` so one auth.users account can never be linked to
  -- two directory rows at once. Nullable -- most rows start unlinked, and
  -- a person who never signs in (see this migration's header comment on
  -- why the directory must support that) stays that way indefinitely.
  user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now()
);

create index team_members_user_id_idx on team_members (user_id);

comment on table team_members is
  'The Foundation First team directory (lib/schema/team.ts''s TeamMember). Independent of auth.users -- lists people, not accounts; `user_id` is an OPTIONAL, admin-set-up-then-self-verified link (see this migration''s header comment on account linking). A later package will FK a task''s assignee to this table''s `id`.';

comment on column team_members.role is
  'DIRECTORY LABEL ONLY -- carries NO permission meaning. The real enforcement authority for what an account can do is that account''s JWT app_metadata.role (supabase/migrations/20260726000015_role_ladder.sql''s role_rank()/has_role_at_least(), and is_admin() before it) -- a value this column cannot see, set, or mirror. See this migration''s header comment for the two-role-stores-can-drift risk this deliberately accepts, and why.';

comment on column team_members.email is
  'Admin-recorded, independent of auth.users.email (may point at an email with no account yet, or drift from that account''s CURRENT email if it later changes there -- both accepted, see this migration''s header comment). Inert metadata until public.link_my_team_member() matches it against a VERIFIED auth.users.email for the calling user -- never trusted for anything on its own.';

comment on column team_members.user_id is
  'auth.users id, once linked via public.link_my_team_member() below. NULL until linked (and forever, for a directory entry with no account at all -- accepted by design, see this migration''s header comment). The ONLY writer of this column is that one SECURITY DEFINER function, self-link only -- no admin write path, no app write path of any other kind, ever sets it.';

-- =============================================================================
-- RLS
-- =============================================================================
alter table team_members enable row level security;

-- `select` is open to every authenticated user (`using (true)`) -- a
-- DIRECTORY, not owner-scoped data: a later package's assignee picker and
-- name-rendering (e.g. "Assigned to Jordan Reyes" on a task card) need
-- every signed-in user to be able to read every row, the same posture
-- `projects_select`/`reports_select` already established for shared
-- reference data in this schema.
create policy team_members_select on team_members for select to authenticated using (true);

-- insert/update/delete are ALL admin-only -- unlike `projects_insert`
-- (open to any authenticated user, since creating a project isn't a
-- privileged act), creating/editing/removing a DIRECTORY ROW here is,
-- because linking `user_id` (via the SECURITY DEFINER RPC below, which
-- bypasses RLS entirely for that one narrow write) is effectively priming
-- an access grant: a later package makes "the assignee of a task can edit
-- it", so an unlinked-vs-linked row -- and by extension, who is even ON
-- this list at all, under what name/email -- must never be
-- member-writable. `is_admin()` (unchanged, supabase/migrations/
-- 20260719000004_auth_ownership.sql) is reused rather than
-- `has_role_at_least('admin')` (the new ladder function landed in the
-- sibling migration) so this table's access story is IDENTICAL to every
-- other admin-only policy in this schema today (`projects_update`/
-- `_delete`) -- graduating any of them to the ladder is the explicitly
-- out-of-scope "RLS access flip" package, not this one.
create policy team_members_insert on team_members for insert to authenticated with check (public.is_admin());
create policy team_members_update on team_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy team_members_delete on team_members for delete to authenticated using (public.is_admin());

-- Same grant-hygiene posture as supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql
-- and 20260724000011_project_management.sql's identical `projects` fix:
-- Supabase's baseline table-creation grant would otherwise leave `anon`
-- holding a full table-level grant (INSERT/SELECT/UPDATE/DELETE, every
-- column) on a BRAND NEW table with no `anon`-targeted RLS policy at all
-- (every policy above is `to authenticated` only) -- RLS already
-- default-denies `anon` regardless, so this is pure hygiene, landed at
-- CREATION time this time (never even briefly exploitable), rather than a
-- later cleanup migration.
revoke all on public.team_members from anon;

-- =============================================================================
-- public.link_my_team_member(): the verified-email self-link RPC (see this
-- migration's header comment for the full account-linking design and why a
-- UUID paste box / self-claim button were both rejected).
--
-- SECURITY DEFINER (bypasses RLS -- deliberately, same posture as
-- enable_report_share/revoke_report_share, supabase/migrations/
-- 20260719000004_auth_ownership.sql: the whole point is to let a NON-ADMIN
-- caller trigger a `user_id` write that `team_members_update`'s admin-only
-- RLS would otherwise refuse). `set search_path = ''` (Supabase's own
-- linter-recommended hardening for every SECURITY DEFINER function in this
-- schema -- see that same migration's identical note) means every
-- relation/function reference below is schema-qualified
-- (`public.team_members`, `auth.users`, `auth.uid()`).
--
-- Scoping, restated precisely (this is the entire security argument):
--   1. `auth.uid()` is the JWT's own subject claim -- a caller can NEVER
--      supply or influence whose uid this function reads; it is always
--      and only the CALLING session's own identity.
--   2. The email compared against is looked up FROM `auth.users` by that
--      SAME uid -- i.e. the caller's own, Supabase-VERIFIED account email
--      (not a client-supplied string), matched case-insensitively against
--      the directory row's admin-recorded `email`.
--   3. `user_id is null` in the WHERE clause means an ALREADY-linked row
--      can never be re-linked (to the same or a different account) via
--      this function -- it silently matches zero rows instead, making
--      repeated calls a safe no-op (this is what "idempotent" means for
--      this function: calling it after the link already happened, or when
--      there was never a matching row at all, has IDENTICAL, harmless
--      output -- NULL).
--   4. `email unique` (the column constraint above) guarantees at most one
--      row could ever match a given email, so this can never link the
--      caller to more than one row even in a race.
-- Together: this function can NEVER link a caller to anyone else's
-- directory row, NEVER re-link an already-linked row out from under
-- whoever holds it, and NEVER be used to enumerate the directory's emails
-- (it returns the linked row only on an ACTUAL, successful link for the
-- CALLER -- never a row for any other caller's email, and never a
-- generic "found but not yours" signal).
-- =============================================================================
create or replace function public.link_my_team_member() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text;
  updated_row public.team_members%rowtype;
begin
  select lower(u.email) into caller_email from auth.users u where u.id = auth.uid();
  if caller_email is null or caller_email = '' then
    return null;
  end if;

  update public.team_members
    set user_id = auth.uid()
    where lower(email) = caller_email and user_id is null
  returning * into updated_row;

  if updated_row.id is null then
    -- No unlinked row matches the caller's verified email (already
    -- linked, no directory row for this person yet, or the email simply
    -- doesn't match anything) -- a harmless no-op, not an error. See the
    -- header comment's idempotence point.
    return null;
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'role', updated_row.role,
    'email', updated_row.email,
    'userId', updated_row.user_id,
    'createdAt', updated_row.created_at
  );
end;
$$;

comment on function public.link_my_team_member() is
  'Self-link ONLY -- sets team_members.user_id = auth.uid() for the single UNLINKED row whose email matches the CALLER''s OWN verified auth.users.email (case-insensitive). Can never link a caller to anyone else''s row, never re-link an already-linked row, never enumerate the directory. Idempotent: a no-op (returns NULL) once linked, or if no row matches. Called once, quietly, after sign-in (components/app/AppShell.tsx) -- a convenience, not a gate; failures are swallowed client-side. See this migration''s header comment for the full design.';

-- Same defense-in-depth rationale as every other SECURITY DEFINER
-- function's revoke/grant pair in this schema (is_admin(),
-- enable_report_share(), et al., supabase/migrations/
-- 20260719000004_auth_ownership.sql) -- Supabase's baseline default
-- privileges would otherwise grant EXECUTE to anon/service_role too. `anon`
-- has no legitimate reason to call this (it reads `auth.uid()`, which is
-- NULL for an anonymous caller, and the function already returns NULL
-- gracefully for that case via the `caller_email is null` guard above --
-- but there is still no reason to leave the grant open).
revoke all on function public.link_my_team_member() from public, anon;
grant execute on function public.link_my_team_member() to authenticated;
