-- Weekly Reports Dashboard -- Phase 7c delta: BYOK AI field polish. The
-- `ai_keys` table (one row per user: their AES-256-GCM-encrypted Anthropic
-- API key) plus the two SECURITY DEFINER functions that are the ONLY paths
-- that ever touch `key_ciphertext` -- `set_own_ai_key()` (write) and
-- `get_own_ai_key_ciphertext()` (read). Read this alongside lib/server/
-- ai-crypto.ts (the encryption) and lib/server/ai-keys.ts (the service
-- layer that calls both RPCs) -- together they are the entire BYOK security
-- surface. See docs/database-schema.md's "ai_keys (BYOK)" section for the
-- full threat model and the operational note on AI_BYOK_ENCRYPTION_KEY
-- rotation.
--
-- Both functions mirror `verify_api_token`'s EXACT posture (Phase 8a,
-- supabase/migrations/20260721000007_mcp_tokens.sql): security definer,
-- `set search_path = ''`, schema-qualified names, and `revoke all ... from
-- public, anon, authenticated` (naming `authenticated` explicitly, not just
-- `public`/`anon`) THEN a narrow, explicit `grant` -- see
-- docs/database-schema.md's "Function EXECUTE grants" section for why
-- naming every non-intended role in the revoke is load-bearing (Supabase's
-- baseline `alter default privileges` grants EXECUTE to anon/authenticated/
-- service_role individually on every new function).
--
-- DELIBERATELY NO public.is_admin() branch ANYWHERE in this migration --
-- tighter than every other table in this schema. Admins manage reports;
-- they must never be able to read another user's Anthropic API key, even
-- as ciphertext (an admin who could read ciphertext would still need
-- AI_BYOK_ENCRYPTION_KEY to decrypt it, which only the app server holds --
-- but the column-level grant below closes even that read regardless of
-- role, and RLS below has no admin carve-out on top of it).
--
-- VERIFIED GOTCHA (why writes go through a DEFINER function too, not just
-- reads): the original design granted `authenticated` a column-scoped
-- UPDATE on `key_ciphertext` (mirroring the read side's column-grant
-- pattern) so a plain client-side `upsert(...).onConflict('user_id')`
-- could write it directly. Verified live that this does NOT work: Postgres
-- requires SELECT privilege on any column referenced via `excluded.<col>`
-- inside an `ON CONFLICT ... DO UPDATE SET` clause -- `authenticated` has
-- (deliberately) no SELECT on `key_ciphertext`, so
-- `insert ... on conflict (user_id) do update set key_ciphertext =
-- excluded.key_ciphertext` failed with `permission denied for table
-- ai_keys` even though the plain INSERT branch alone succeeded (isolated
-- and reproduced directly via `psql` with `set role authenticated; set
-- request.jwt.claims = ...`, one `SET` clause at a time). Since the whole
-- point is that `authenticated` must never be able to SELECT that column,
-- an authenticated-role-executed upsert can never satisfy both properties
-- at once -- the fix is `set_own_ai_key()` below, a SECURITY DEFINER
-- function (so the privilege check runs as the function owner, which has
-- full table access, not as the calling role).

create table public.ai_keys (
  -- `default auth.uid()` (a plain function call -- a subquery is NOT
  -- allowed in a column DEFAULT expression, verified: Postgres rejects
  -- `default (select auth.uid())` outright with "cannot use subquery in
  -- DEFAULT expression") is a defensive fallback, not load-bearing for
  -- this app's own write path (that always goes through set_own_ai_key()
  -- below, which sets user_id explicitly) -- kept so a future direct
  -- INSERT (Studio, a script) still lands the right value without having
  -- to know to set this column.
  user_id         uuid primary key not null default auth.uid() references auth.users (id) on delete cascade,
  -- base64(iv (12 bytes) || authTag (16 bytes) || ciphertext), AES-256-GCM.
  -- The encryption key is AI_BYOK_ENCRYPTION_KEY, a Next server-only env
  -- var -- NEVER present in Postgres, in any form, ever. This column is
  -- opaque to every SQL role, including service_role (which this app never
  -- uses anywhere -- see lib/server/mcp-auth.ts's header comment for the
  -- identical "no service-role key anywhere" invariant). See
  -- lib/server/ai-crypto.ts for the encrypt/decrypt implementation.
  key_ciphertext  text not null,
  -- Display-only fingerprint, e.g. "sk-ant-...ab12" -- computed server-side
  -- from the plaintext at save time (lib/server/ai-keys.ts's
  -- `fingerprint`), never derived from key_ciphertext, and never the key
  -- itself. Standard "so a user can tell which key is configured without
  -- ever seeing it again" practice -- same idea as a credit card's last 4.
  key_hint        text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Stamped by set_own_ai_key() below (server-side `now()`, never a
  -- client-supplied timestamp -- same "never trust a client clock" posture
  -- as replace_reports stamping reports.updated_at itself) every time a key
  -- is successfully validated against Anthropic and stored.
  validated_at    timestamptz,
  -- Stamped by get_own_ai_key_ciphertext() below, every time this user's
  -- ciphertext is READ for a polish attempt -- not gated on whether the
  -- subsequent Anthropic call for that attempt actually succeeds. See that
  -- function's own comment for why (mirrors verify_api_token's "one round
  -- trip" precedent exactly).
  last_used_at    timestamptz
);

comment on table public.ai_keys is
  'Phase 7c. One row per user: their BYOK Anthropic API key, AES-256-GCM-encrypted at rest under the server-only AI_BYOK_ENCRYPTION_KEY env var (never present in Postgres in any form). Owner-only RLS on every verb, deliberately NO is_admin() branch -- see this migration''s header comment and docs/database-schema.md. Every write to key_ciphertext goes through set_own_ai_key() (SECURITY DEFINER) -- see this migration''s "VERIFIED GOTCHA" note for why a direct client-side upsert cannot work here.';

alter table public.ai_keys enable row level security;

-- Strictly owner-only, every verb. NO public.is_admin() anywhere on this
-- table -- see this migration's header comment. INSERT/UPDATE are kept as
-- real policies for defense-in-depth/documentation even though NEITHER
-- verb is granted to `authenticated` at the table-privilege level below
-- (all writes to key_ciphertext go through set_own_ai_key() instead, whose
-- SECURITY DEFINER bypasses RLS entirely) -- if a future migration ever
-- re-opens a direct grant by mistake, this is still the correct backstop.
create policy ai_keys_select on public.ai_keys for select to authenticated using (user_id = (select auth.uid()));
create policy ai_keys_insert on public.ai_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy ai_keys_update on public.ai_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ai_keys_delete on public.ai_keys for delete to authenticated using (user_id = (select auth.uid()));

-- Column-grant hardening (the api_tokens.token_hash / reports.share_token
-- precedent, supabase/migrations/20260719000004_auth_ownership.sql /
-- 20260720000005_post_review_hardening.sql): close Supabase's default
-- full-table grants first, then re-grant only what `authenticated` actually
-- needs directly. NO insert/update grant at all -- see this migration's
-- header "VERIFIED GOTCHA" note: every write to key_ciphertext goes through
-- set_own_ai_key() below instead. DELETE stays a plain table-level grant
-- (no EXCLUDED-column privilege issue applies to DELETE -- verified
-- directly, see docs/database-schema.md).
revoke all on public.ai_keys from anon;
revoke select, insert, update, delete on public.ai_keys from authenticated;
grant select (user_id, key_hint, created_at, updated_at, validated_at, last_used_at) on public.ai_keys to authenticated;
grant delete on public.ai_keys to authenticated;

-- =============================================================================
-- set_own_ai_key: the ONLY write path for key_ciphertext (insert-or-replace).
-- =============================================================================
-- auth.uid()-scoped, no id argument -- there is no legitimate reason for
-- this to ever write anyone else's row. Runs as the function owner (full
-- table privileges), which is exactly what lets it do
-- `on conflict (user_id) do update set key_ciphertext = excluded.key_ciphertext`
-- without `authenticated` ever needing SELECT on that column -- see this
-- migration's header "VERIFIED GOTCHA" note for why a plain client-side
-- upsert cannot do this. `validated_at`/`updated_at` are stamped from a
-- single `now()` captured once at the top of the function, server-side --
-- never a client-supplied timestamp. Returns the stamped `validated_at` so
-- the caller (lib/server/ai-keys.ts's setAiKey) can echo back what was
-- ACTUALLY written, not a process-local guess (same "return what was really
-- written" discipline replace_reports uses for reports.updated_at).
create or replace function public.set_own_ai_key(p_key_ciphertext text, p_key_hint text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.ai_keys (user_id, key_ciphertext, key_hint, validated_at, updated_at)
  values ((select auth.uid()), p_key_ciphertext, p_key_hint, v_now, v_now)
  on conflict (user_id) do update
  set key_ciphertext = excluded.key_ciphertext,
      key_hint = excluded.key_hint,
      validated_at = excluded.validated_at,
      updated_at = excluded.updated_at;

  return v_now;
end;
$$;

comment on function public.set_own_ai_key(text, text) is
  'Phase 7c. auth.uid()-scoped, no id argument. The ONLY write path for ai_keys.key_ciphertext -- insert-or-replace, server-stamping validated_at/updated_at itself (never a client-supplied timestamp) and returning the validated_at it wrote. SECURITY DEFINER specifically so the ON CONFLICT DO UPDATE SET key_ciphertext = excluded.key_ciphertext clause does not require authenticated to hold SELECT on that column (see this migration''s header "VERIFIED GOTCHA" note -- a plain client-side upsert cannot satisfy both properties at once). Called by lib/server/ai-keys.ts''s setAiKey, AFTER validateAnthropicKey has already confirmed the key against Anthropic -- an invalid key never reaches this function at all.';

revoke all on function public.set_own_ai_key(text, text) from public, anon, authenticated;
grant execute on function public.set_own_ai_key(text, text) to authenticated;

-- =============================================================================
-- get_own_ai_key_ciphertext: the ONLY read path for key_ciphertext.
-- =============================================================================
-- auth.uid()-scoped, takes no argument -- there is no legitimate reason for
-- this to ever read anyone else's row, so unlike get_shared_report/
-- verify_api_token (which must accept an opaque token from an unauthenticated
-- caller), this one has nothing to look up BY -- it only ever resolves the
-- CALLER's own row. A single atomic `UPDATE ... RETURNING` (not a SELECT
-- then a separate UPDATE) stamps last_used_at and returns the ciphertext in
-- one round trip -- the identical TOCTOU-closing technique verify_api_token
-- uses for stamping ITS last_used_at. Returns NULL if the caller has no
-- stored key (never raises for that case -- "no key yet" is ordinary).
create or replace function public.get_own_ai_key_ciphertext()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ciphertext text;
begin
  update public.ai_keys
  set last_used_at = now()
  where user_id = (select auth.uid())
  returning key_ciphertext into v_ciphertext;

  return v_ciphertext;
end;
$$;

comment on function public.get_own_ai_key_ciphertext() is
  'Phase 7c. auth.uid()-scoped, no argument. The ONLY read path for ai_keys.key_ciphertext (excluded from authenticated''s own SELECT grant above). Stamps last_used_at atomically via UPDATE ... RETURNING (mirrors verify_api_token''s TOCTOU-closing technique) -- returns NULL if the caller has no stored key. Called by lib/server/ai-keys.ts''s getAiKeyPlaintext via the COOKIE-BOUND client (there is a real session here, unlike the MCP bridge''s bare anon client) -- decryption happens in Node (lib/server/ai-crypto.ts), never in SQL, so this function never sees a plaintext key.';

-- Name `authenticated` explicitly in this revoke too (not just
-- public/anon) -- the auth-hook-incident rule, docs/database-schema.md's
-- "Function EXECUTE grants" section: Supabase's baseline `alter default
-- privileges` grants EXECUTE to anon/authenticated/service_role
-- individually on every new function, so `revoke ... from public` alone
-- does NOT close this off -- verify via pg_proc.proacl, never the revoke
-- statement's intent alone. `anon` has no session to be auth.uid()-scoped
-- as, so it is excluded from the grant entirely (unlike verify_api_token,
-- which is anon-only for the opposite reason -- there, anon IS the only
-- real caller, since an MCP request carries no session at all).
revoke all on function public.get_own_ai_key_ciphertext() from public, anon, authenticated;
grant execute on function public.get_own_ai_key_ciphertext() to authenticated;
