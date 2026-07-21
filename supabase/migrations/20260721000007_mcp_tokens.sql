-- Weekly Reports Dashboard -- Phase 8a delta: MCP bearer-token verification
-- + revocation RPCs. This is the SQL half of the auth-to-Supabase-client
-- bridge documented in lib/server/mcp-auth.ts's header comment -- read that
-- file alongside this one; together they are the ENTIRE privilege-elevation
-- surface for Phase 8's MCP server (bearer tokens only -- Phase 8b's OAuth
-- layers on top of the SAME api_tokens table + verify_api_token, adding no
-- new elevated function of its own).
--
-- api_tokens itself (id, user_id, token_hash sha-256 hex, label, created_at,
-- last_used_at, expires_at, revoked_at) and its RLS (select/insert/delete
-- own rows only, no update policy -- "tokens are create/revoke only", see
-- that migration's comment) already landed in
-- supabase/migrations/20260719000004_auth_ownership.sql -- this migration
-- adds the two functions Phase 8a's route handlers and MCP auth bridge
-- actually call, following enable_report_share's exact posture: security
-- definer, `set search_path = ''`, schema-qualified names, hand-written
-- ownership/validity checks, revoke-then-narrow-grant.

-- =============================================================================
-- verify_api_token: opaque bearer token -> user_id, or NULL.
-- =============================================================================
-- Called via the BARE anon client (lib/supabase/anon.ts) -- an inbound MCP
-- request carries no session cookie at all, so there is no "caller's own
-- uid" to lean on the way enable_report_share does; this function IS the
-- identity check, and its return value becomes the `sub` claim of the JWT
-- lib/server/mcp-auth.ts mints next. SECURITY DEFINER so it can read
-- token_hash (excluded from `authenticated`'s own SELECT grant already --
-- see the 7a migration's api_tokens grant -- and never granted to `anon` at
-- all) and stamp last_used_at despite api_tokens having no UPDATE policy for
-- anyone (this function is precisely the carve-out that migration's "no
-- UPDATE policy: tokens are create/revoke only" comment refers to).
--
-- `extensions.digest(p_token, 'sha256')` (pgcrypto, already enabled -- see
-- enable_report_share's `extensions.gen_random_bytes` in the 7a migration)
-- mirrors lib/server/mcp-auth.ts's `hashApiTokenForStorage` (a plain
-- `node:crypto.createHash('sha256').update(token).digest('hex')`)
-- byte-for-byte: same algorithm, same hex encoding -- a token minted by
-- `POST /api/tokens` (Node) and looked up here (Postgres) always hash
-- identically.
--
-- A single atomic `UPDATE ... RETURNING` (not a SELECT followed by a
-- separate UPDATE) closes the obvious TOCTOU window: the WHERE clause's
-- revoked_at/expires_at check is evaluated against the row exactly once,
-- atomically, so a token revoked concurrently with this call either wins the
-- race (no row matches, v_user_id stays NULL) or loses it (row matches,
-- gets its last_used_at bumped and its owner returned) -- it can never do
-- both, and there is no intermediate state where a stale read could return
-- an already-revoked token's owner.
create or replace function public.verify_api_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_user_id uuid;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.api_tokens
  set last_used_at = now()
  where token_hash = v_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning user_id into v_user_id;

  return v_user_id;
end;
$$;

comment on function public.verify_api_token(text) is
  'Phase 8a. The ONLY elevated (SECURITY DEFINER) step in the MCP auth bridge -- see lib/server/mcp-auth.ts''s header comment for the full flow. Hashes p_token (sha-256 hex), looks it up in api_tokens, rejects a revoked/expired match, stamps last_used_at, returns the owning user_id (or NULL for anything else -- missing, garbage, revoked, expired). Never distinguishes WHY to the caller -- lib/server/mcp-auth.ts turns any NULL into a uniform 401.';

-- Anon-only (deliberately narrower than get_shared_report''s anon+authenticated
-- grant): the MCP bridge always calls this via the bare, cookie-less anon
-- client (lib/supabase/anon.ts) -- there is no session to be "authenticated"
-- as at this point in the flow; the bearer token IS the identity proof.
-- Nothing in this app ever calls verify_api_token from an authenticated
-- session, unlike get_shared_report (which a signed-in visitor might
-- legitimately open while already logged in) -- narrowing the grant to the
-- one real caller is defense in depth, not a functional requirement (the
-- token-hash lookup + revoked/expired check inside the function would still
-- hold either way). 256-bit token entropy (lib/server/mcp-auth.ts's
-- hashApiTokenForStorage input, minted by app/api/tokens/route.ts) makes
-- online guessing against this anon-callable function moot -- same posture
-- CLAUDE.md documents for get_shared_report's anon-reachable share tokens.
--
-- `service_role` is deliberately NOT named in the `revoke` below (same as
-- every other function in this schema -- `is_admin()`, `get_shared_report`,
-- `enable_report_share`/`revoke_report_share`, `replace_reports`): Supabase's
-- baseline `alter default privileges ... grant execute on functions to anon,
-- authenticated, service_role` means `service_role` retains EXECUTE
-- regardless of what this migration revokes from `public`/`anon`/
-- `authenticated`. This is the accepted, existing posture repo-wide, not a
-- gap specific to this function -- and it's benign here specifically because
-- the service-role key is never present anywhere in this app (see
-- lib/server/mcp-auth.ts's header comment: no service-role client is ever
-- constructed). Verify via `pg_proc.proacl`, per docs/database-schema.md's
-- "Function EXECUTE grants" discipline, not by re-reading this `revoke`
-- statement's intent alone.
revoke all on function public.verify_api_token(text) from public, anon, authenticated;
grant execute on function public.verify_api_token(text) to anon;

-- =============================================================================
-- revoke_api_token: owner-only, sets revoked_at (never a DELETE -- keeps the
-- audit trail, per api_tokens' own revoked_at column comment, 7a migration).
-- =============================================================================
-- SECURITY DEFINER purely because api_tokens has NO update policy at all (7a:
-- "tokens are create/revoke only" -- by design, so nothing short of this one
-- sanctioned path can extend or otherwise mutate a token's life) -- this
-- function re-implements the ownership check by hand since DEFINER bypasses
-- RLS entirely, identical posture to enable_report_share/revoke_report_share.
-- Idempotent by design (`coalesce(revoked_at, now())`, not a bare
-- `revoked_at = now()`): a caller re-revoking an already-revoked token of
-- their own keeps its ORIGINAL revocation timestamp and still succeeds,
-- mirroring revoke_report_share's own idempotent "set to the terminal state,
-- regardless of current state" shape -- only a missing id or a foreign
-- (not-owned) id raises.
create or replace function public.revoke_api_token(p_token_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.api_tokens t
    where t.id = p_token_id and t.user_id = (select auth.uid())
  ) then
    raise exception 'Token not found or not permitted' using errcode = '42501';
  end if;

  update public.api_tokens
  set revoked_at = coalesce(revoked_at, now())
  where id = p_token_id;
end;
$$;

comment on function public.revoke_api_token(text) is
  'Phase 8a. Owner-only (auth.uid() = api_tokens.user_id). Sets revoked_at = now() (idempotent -- a second call on an already-revoked token of your own keeps the original timestamp) -- never a DELETE, preserving the audit trail. Raises 42501 if the id does not exist or is not owned by the caller. app/api/tokens/[id]/route.ts''s DELETE handler is the sole caller, via the cookie-bound client (api_tokens has no UPDATE policy of its own -- this DEFINER function is the only sanctioned path).';

revoke all on function public.revoke_api_token(text) from public, anon;
grant execute on function public.revoke_api_token(text) to authenticated;
-- `anon` deliberately excluded, same rationale as enable_report_share/
-- revoke_report_share: anon has no account, so it has no token to revoke and
-- no legitimate reason to call this at all. `service_role` again retains
-- EXECUTE by Supabase default (not named above) -- see the identical note on
-- verify_api_token's grant, same accepted posture, same reason it's benign.
