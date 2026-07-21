-- Weekly Reports Dashboard -- Phase 8b delta: OAuth 2.1 (+ dynamic client
-- registration) so claude.ai's custom-connector UI (which cannot send a
-- static bearer header) can reach the same MCP server Phase 8a shipped.
--
-- THE LAYERING INVARIANT (confirmed, not assumed -- read lib/server/
-- mcp-auth.ts before touching this file): an OAuth-issued access token is
-- JUST another api_tokens row, looked up by verify_api_token
-- (supabase/migrations/20260721000007_mcp_tokens.sql) EXACTLY the way a
-- Phase 8a `POST /api/tokens`-minted bearer token is. verify_api_token
-- needed ZERO changes for this phase -- it hashes whatever text it's given
-- and looks up `token_hash`, indifferent to which of the two issuance
-- paths below produced the row, or to the new `kind`/`oauth_client_id`/
-- `refresh_token_hash`/`refresh_expires_at` columns this migration adds.
-- lib/server/mcp-auth.ts and lib/server/mcp-tools.ts are UNTOUCHED by this
-- phase -- confirm via `git diff --stat` in this PR.
--
-- New tables:
--   - oauth_clients -- one row per RFC 7591 Dynamic Client Registration.
--     PUBLIC CLIENTS ONLY (no client_secret column exists at all -- every
--     client authenticates via PKCE, never a secret).
--   - oauth_codes -- single-use, hashed authorization codes, bound to
--     client_id + redirect_uri + code_challenge, 10-minute TTL.
-- Extended: api_tokens (+kind, +oauth_client_id, +refresh_token_hash,
-- +refresh_expires_at -- see each column's own comment).
--
-- Every new SECURITY DEFINER function below mirrors enable_report_share /
-- verify_api_token's EXACT posture: `security definer`, `set search_path =
-- ''`, schema-qualified names, hand-written checks, generate-secret-in-SQL-
-- return-once, `revoke ... from public, anon, authenticated` THEN a narrow,
-- explicit `grant` -- verify via `pg_proc.proacl`, never the revoke
-- statement's intent alone (this repo has been burned twice by Supabase's
-- default per-role FUNCTION EXECUTE grants surviving a `revoke ... from
-- public` -- see docs/database-schema.md's "Function EXECUTE grants"
-- section). Table-level DML privileges are a DIFFERENT mechanism than
-- function EXECUTE grants and are NOT subject to that same default-grant
-- gotcha -- RLS with no matching policy is a hard deny for every role
-- regardless of table grants (verified precedent: `projects` needed an
-- explicit `projects_insert ... with check (true)` policy before ANY
-- authenticated INSERT worked at all). **Precise per-table posture, not a
-- blanket one** (post-review wording fix -- the two tables are NOT
-- identical): `oauth_codes` is genuinely deny-all for every command and
-- every client role (zero policies at all). `oauth_clients` is deny-all
-- for insert/update/delete (zero policies for those commands) but DOES
-- have a `select` policy open to `authenticated` -- see that table's own
-- section below for why (the consent screen needs to read a client's
-- display name/redirect_uris, and none of that is secret). Every WRITE
-- path to either table goes through a SECURITY DEFINER function (bypasses
-- RLS, runs as the function's OWNER, never as anon/authenticated).

-- =============================================================================
-- 1) oauth_clients -- RFC 7591 dynamic client registration records.
-- =============================================================================

-- THE primary control (per the approved plan: "the allowlist is the
-- primary control; do not weaken it") -- enforced here, at the schema
-- level, REDUNDANTLY with app/oauth/register/route.ts's own check
-- (lib/server/oauth.ts's isAllowedRedirectUri, which does real WHATWG URL
-- parsing rather than string/regex matching -- more precise, e.g. correctly
-- rejects a userinfo-smuggled host like "https://claude.ai@evil.com/x",
-- whose hostname a URL parser resolves to "evil.com") -- THREE independent
-- layers total, counting oauth_register_client()'s own call to this SAME
-- function below, so a bug in any ONE of them can never alone smuggle a
-- non-Claude redirect_uri into this table. Every element of p_redirect_uris
-- must be `https://`, host exactly `claude.ai`/`claude.com` or a subdomain
-- of either, any path -- and the array must be non-empty (an EMPTY array
-- makes `bool_and(...)` aggregate over zero rows, which SQL defines as
-- NULL, not TRUE -- `coalesce(..., false)` is what turns "no elements to
-- check" into a correct REJECTION rather than a vacuous pass). Verified
-- against attack strings by hand (see PR notes): "https://evilclaude.ai/x",
-- "https://claude.ai.evil.com/x", "https://claude.ai@evil.com/x", and
-- "http://claude.ai/x" (wrong scheme) all FAIL this pattern;
-- "https://claude.ai/x", "https://console.claude.com/x" both PASS.
--
-- A plain SQL function, not inlined into a table CHECK constraint directly:
-- Postgres does not allow a subquery (which `unnest()` + an aggregate
-- requires) inside a CHECK expression at all ("cannot use subquery in
-- check constraint") -- wrapping the exact same logic in a function call
-- sidesteps that restriction (the subquery lives inside the function body,
-- which is opaque to the CHECK expression itself) and, as a bonus, gives
-- oauth_register_client() a single source of truth to call instead of
-- duplicating this regex.
create or replace function public.oauth_redirect_uris_allowlisted(p_redirect_uris text[])
returns boolean
language sql
immutable
as $$
  select coalesce(
    bool_and(u.uri ~ '^https://([a-zA-Z0-9-]+\.)*claude\.(ai|com)(/.*)?$'),
    false
  )
  from unnest(p_redirect_uris) as u(uri);
$$;

comment on function public.oauth_redirect_uris_allowlisted(text[]) is
  'Phase 8b. TRUE iff p_redirect_uris is non-empty AND every element is an https:// URL whose host is exactly claude.ai/claude.com or a subdomain of either. The shared allowlist predicate for the oauth_clients_redirect_uris_allowlist CHECK constraint below AND oauth_register_client()''s own pre-insert validation -- one regex, two call sites, no drift.';

-- Purely a read-only predicate over its own argument (no table access, no
-- side effects) -- narrowing its default anon/authenticated EXECUTE grant
-- is not a security requirement the way it is for the DEFINER functions
-- below, but revoke-then-narrow is applied anyway for consistency with
-- this migration''s blanket posture (nobody outside this schema has a
-- legitimate reason to call it directly).
revoke all on function public.oauth_redirect_uris_allowlisted(text[]) from public, anon, authenticated;

create table oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

comment on table oauth_clients is
  'Phase 8b. One row per RFC 7591 Dynamic Client Registration (claude.ai registers itself here before starting the auth-code flow -- app/oauth/register/route.ts). PUBLIC CLIENTS ONLY -- no client_secret column exists at all; every issued client authenticates via PKCE only (token_endpoint_auth_methods_supported: ["none"] in /.well-known/oauth-authorization-server). Rows are created ONLY by public.oauth_register_client() below -- there is no INSERT policy for any client role (RLS enabled, zero insert/update/delete policies -- see "Function EXECUTE grants" discipline note in this file''s header). `select` IS open to `authenticated` (see the policy below) -- this table is NOT deny-all like oauth_codes. oauth_register_client() caps this table at 500 rows total (post-review should-fix -- DCR is anon-callable with no auth, and an unbounded loop could otherwise grow it forever). PRUNING (not automated in this phase -- run manually/periodically, or wire into a future scheduled job): `delete from oauth_clients c where c.created_at < now() - interval ''90 days'' and not exists (select 1 from api_tokens t where t.oauth_client_id = c.client_id) and not exists (select 1 from oauth_codes oc where oc.client_id = c.client_id);` -- safe because of the `on delete cascade` FKs from both api_tokens.oauth_client_id and oauth_codes.client_id, so this only ever removes a client that never successfully completed a flow and has no pending code either.';

alter table oauth_clients add constraint oauth_clients_redirect_uris_allowlist check (
  public.oauth_redirect_uris_allowlisted(redirect_uris)
);

alter table oauth_clients enable row level security;
-- Shared reference data, same posture as `projects`: any authenticated
-- (already-signed-in) user reaches this ONLY from app/oauth/authorize's
-- consent screen, to look up the client's display name/redirect_uris and
-- validate the incoming request -- never written directly (see the
-- DEFINER-only insert path above; there is deliberately no insert/update/
-- delete policy for any role).
create policy oauth_clients_select on oauth_clients for select to authenticated using (true);

-- Supports the pruning query documented in the table comment above (a
-- `WHERE created_at < ...` scan) -- also generally useful once this table
-- has real rows, even though the 500-row cap above means it will never be
-- large enough for this index to matter for correctness, only for the
-- pruning query's plan.
create index oauth_clients_created_at_idx on oauth_clients (created_at);

-- =============================================================================
-- 2) oauth_codes -- single-use, hashed authorization codes.
-- =============================================================================
create table oauth_codes (
  code_hash text primary key,           -- sha-256 hex; plaintext never stored (mirrors api_tokens.token_hash)
  client_id text not null references oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,         -- S256 only, system-wide -- see oauth_exchange_code's comment for why no method column exists
  expires_at timestamptz not null,
  used_at timestamptz,                  -- stamped atomically by oauth_exchange_code below -- NULL = still redeemable
  created_at timestamptz not null default now()
);

comment on table oauth_codes is
  'Phase 8b. One row per issued authorization code, created ONLY by public.oauth_create_authorization_code() below, consumed ONLY by public.oauth_exchange_code() below -- both SECURITY DEFINER. RLS is enabled with ZERO policies (default-deny for every command, every role, except the functions'' owner) -- there is deliberately no client-reachable read/write path to this table at all, not even a SELECT. code_challenge is stored in the clear (it is a PUBLIC value, transmitted in the original /oauth/authorize request -- PKCE''s whole point is that only the code_verifier, sent for the first time at token-exchange, is secret) -- code_hash is what is actually secret here, exactly like api_tokens.token_hash.';

alter table oauth_codes enable row level security;
-- Deliberately zero policies -- see table comment above.

create index oauth_codes_client_id_idx on oauth_codes (client_id);
create index oauth_codes_expires_at_idx on oauth_codes (expires_at);
comment on index oauth_codes_expires_at_idx is
  'Supports a future cleanup job (delete where expires_at < now() - interval ...) -- not built in Phase 8b (codes are short-TTL and single-use; an un-vacuumed table of expired codes is a housekeeping concern, not a security one -- a used/expired code can never be redeemed regardless of row presence, per oauth_exchange_code''s atomic check below).';

-- =============================================================================
-- 3) api_tokens extension -- an OAuth access token IS an api_tokens row.
-- =============================================================================
alter table api_tokens
  add column kind text not null default 'mcp' check (kind in ('mcp', 'oauth')),
  add column oauth_client_id text references oauth_clients (client_id) on delete cascade,
  add column refresh_token_hash text unique,
  -- Beyond the plan's literal column list -- necessary, not scope creep:
  -- an OAuth access token (`expires_at`, already-existing column, ~30
  -- days) and its paired refresh token (~90 days) genuinely need
  -- INDEPENDENT expiries -- reusing one column for both would either
  -- expire the refresh token early (killing a still-valid session) or let
  -- it silently outlive its stated ~90-day budget. Landed now, while every
  -- existing row's value is NULL (Phase 8a issues no refresh tokens), the
  -- same "cheapest possible time to extend the schema" precedent as 7a's
  -- expires_at/revoked_at addition (see that migration's own comment).
  add column refresh_expires_at timestamptz;

comment on column api_tokens.kind is
  'Phase 8b. ''mcp'' = a Phase 8a POST /api/tokens bearer token (app/api/tokens/route.ts); ''oauth'' = issued by oauth_exchange_code/oauth_refresh_token below, via the claude.ai connector flow. verify_api_token (Phase 8a) is INDIFFERENT to this column -- it looks up purely by token_hash -- so both kinds authenticate an MCP call through the exact same bridge (lib/server/mcp-auth.ts), under the exact same RLS. Nothing in this schema treats one kind as more privileged than the other.';
comment on column api_tokens.oauth_client_id is
  'Phase 8b. NULL for kind=''mcp''; the registering oauth_clients.client_id for kind=''oauth''. Enforced by api_tokens_oauth_kind_consistency below.';
comment on column api_tokens.refresh_token_hash is
  'Phase 8b. sha-256 hex of the rotating OAuth refresh token; NULL for kind=''mcp'' (Phase 8a tokens are never refreshed -- revoke and re-create instead). UNIQUE so a hash collision (astronomically unlikely at 256 bits of entropy) can never silently let one refresh token authenticate as two different rows.';
comment on column api_tokens.refresh_expires_at is
  'Phase 8b. NULL for kind=''mcp''. See this column''s own ALTER TABLE header comment for why it is independent from expires_at (the paired access token''s own expiry).';

alter table api_tokens add constraint api_tokens_oauth_kind_consistency check (
  (kind = 'oauth' and oauth_client_id is not null) or
  (kind = 'mcp' and oauth_client_id is null and refresh_token_hash is null and refresh_expires_at is null)
);

-- Post-review-hardening-style column-privilege lockdown (surfaced while
-- extending this table, not a regression this migration introduces --
-- Phase 7a never restricted api_tokens' INSERT columns at all, unlike its
-- own reports.share_token precedent in the SAME migration -- fixed here,
-- narrowly, as a direct consequence of adding four new sensitive columns):
-- none of kind/oauth_client_id/refresh_token_hash/refresh_expires_at (nor
-- expires_at/revoked_at/last_used_at, already server-only in practice)
-- should EVER be writable via a plain authenticated INSERT -- every write
-- to them goes through a SECURITY DEFINER function. `app/api/tokens
-- /route.ts`'s POST inserts EXACTLY {id, user_id, token_hash, label} today
-- -- this narrowed column list is 100% compatible with that existing call
-- site (verified by reading it, not just asserting it).
revoke insert on api_tokens from authenticated;
grant insert (id, user_id, token_hash, label) on api_tokens to authenticated;

-- Widen the existing column-restricted SELECT grant (7a) to include the
-- two new NON-secret columns (kind, oauth_client_id, refresh_expires_at)
-- so a future Settings UI can distinguish an MCP token from an OAuth
-- connector session -- `refresh_token_hash` is deliberately EXCLUDED,
-- same rationale as token_hash itself (a verifier, never something a
-- client should read back).
revoke select on api_tokens from authenticated;
grant select (id, user_id, label, created_at, last_used_at, expires_at, revoked_at, kind, oauth_client_id, refresh_expires_at) on api_tokens to authenticated;

create index api_tokens_oauth_client_id_idx on api_tokens (oauth_client_id) where oauth_client_id is not null;

-- =============================================================================
-- 4) oauth_register_client -- RFC 7591 DCR (app/oauth/register/route.ts).
-- =============================================================================
-- Called via the BARE anon client (DCR is unauthenticated by protocol --
-- there is no user session to bind a CLIENT REGISTRATION to; a "client"
-- here is a claude.ai connector installation, not a user). Re-validates
-- the redirect_uri allowlist itself, via the SAME
-- oauth_redirect_uris_allowlisted() predicate the table's own CHECK
-- constraint uses (see that function's comment for why this is the SECOND
-- of three independent layers) -- never trust the caller's own pre-check
-- alone.
create or replace function public.oauth_register_client(p_client_name text, p_redirect_uris text[])
returns table (client_id text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id text;
  v_created_at timestamptz;
begin
  if not public.oauth_redirect_uris_allowlisted(p_redirect_uris) then
    raise exception 'redirect_uris must be a non-empty array of https://claude.ai or https://claude.com URLs' using errcode = '22023';
  end if;

  -- Post-review should-fix: `oauth_register_client` is anon-callable with
  -- no auth, no rate limit, and (until now) no cap -- an unbounded loop of
  -- `POST /oauth/register` with valid claude.ai URIs could otherwise grow
  -- this table without limit (a storage/table-bloat DoS, proportionate to
  -- fix for a 2-10-user internal tool with a simple hard cap rather than a
  -- full rate-limiter). `count(*)` here is cheap forever BY CONSTRUCTION --
  -- this same cap keeps the table from ever growing past it, so the scan
  -- this performs never gets more expensive than counting ~500 rows.
  -- Pruning stale, never-used clients (see the index/comment on
  -- oauth_clients.created_at below) is the intended way to make room
  -- again, not raising this constant.
  if (select count(*) from public.oauth_clients) >= 500 then
    raise exception 'Too many registered clients -- contact an administrator to prune unused ones' using errcode = '53400';
  end if;

  -- Schema-qualified (pg_catalog.gen_random_uuid(), not a bare call) --
  -- matching this file's own `search_path = ''` discipline: pg_catalog is
  -- always implicitly searched regardless of search_path, so this resolves
  -- identically either way, but explicit qualification is the same
  -- consistency this repo already applies to `extensions.gen_random_bytes`/
  -- `extensions.digest` below -- confirmed live that BOTH
  -- `pg_catalog.gen_random_uuid` and `extensions.gen_random_uuid` exist in
  -- this database (pgcrypto vs. the native PG13+ builtin), so qualifying
  -- removes any ambiguity about which one is actually called.
  v_client_id := 'client_' || pg_catalog.gen_random_uuid()::text;

  insert into public.oauth_clients (client_id, client_name, redirect_uris)
  values (v_client_id, nullif(btrim(coalesce(p_client_name, '')), ''), p_redirect_uris)
  returning oauth_clients.created_at into v_created_at;

  return query select v_client_id, v_created_at;
end;
$$;

comment on function public.oauth_register_client(text, text[]) is
  'Phase 8b. Unauthenticated RFC 7591 DCR -- called via the bare anon client (app/oauth/register/route.ts). Re-validates the claude.ai/claude.com redirect_uri allowlist itself (defense in depth beyond the route handler''s own real-URL-parsing check and the oauth_clients_redirect_uris_allowlist CHECK constraint) before generating a fresh client_id and inserting. Returns the new client_id + created_at -- there is no client_secret (public clients only, PKCE-only).';

revoke all on function public.oauth_register_client(text, text[]) from public, anon, authenticated;
grant execute on function public.oauth_register_client(text, text[]) to anon;

-- =============================================================================
-- 5) oauth_create_authorization_code -- issues a code from the consent
--    screen (app/oauth/authorize/decision/route.ts).
-- =============================================================================
-- Called via the COOKIE-BOUND, authenticated client -- `(select auth.uid())`
-- is the consenting user, NEVER a client-supplied parameter (there is no
-- p_user_id argument at all, by design -- a caller cannot mint a code for
-- anyone but themselves). Re-validates client_id/redirect_uri pairing
-- AGAIN, independently of the route handler's own re-check (belt-and-
-- braces -- see that route's header comment) -- a code can only ever be
-- issued for a redirect_uri that is ACTUALLY a member of the named
-- client's OWN registered set, not merely "some allowlisted domain."
create or replace function public.oauth_create_authorization_code(
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_client record;
  v_code text;
  v_hash text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_client from public.oauth_clients c where c.client_id = p_client_id;
  if not found then
    raise exception 'Unknown client' using errcode = '22023';
  end if;

  if p_redirect_uri is null or not (p_redirect_uri = any (v_client.redirect_uris)) then
    raise exception 'redirect_uri does not match the registered client' using errcode = '22023';
  end if;

  if p_code_challenge is null or length(btrim(p_code_challenge)) = 0 then
    raise exception 'code_challenge (S256) is required' using errcode = '22023';
  end if;

  -- 32 random bytes, base64url-encoded, no padding -- same entropy/shape
  -- convention as api_tokens' own bearer tokens (Phase 8a) and
  -- enable_report_share's share tokens.
  v_code := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

  insert into public.oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
  values (v_hash, p_client_id, v_uid, p_redirect_uri, p_code_challenge, now() + interval '10 minutes');

  return v_code;
end;
$$;

comment on function public.oauth_create_authorization_code(text, text, text) is
  'Phase 8b. Authenticated-only -- (select auth.uid()) is the consenting user, never a parameter. Re-validates client_id/redirect_uri pairing against oauth_clients (independent of the caller''s own re-check). Generates a fresh, high-entropy code (32 random bytes, base64url, hex-hashed for storage -- mirrors api_tokens.token_hash), stores it with a 10-minute expiry, and returns the plaintext ONCE. app/oauth/authorize/decision/route.ts''s Approve path is the sole caller.';

revoke all on function public.oauth_create_authorization_code(text, text, text) from public, anon, authenticated;
grant execute on function public.oauth_create_authorization_code(text, text, text) to authenticated;

-- =============================================================================
-- 6) oauth_exchange_code -- POST /oauth/token, grant_type=authorization_code.
-- =============================================================================
-- Called via the BARE anon client (token exchange is a direct
-- client-to-server call, never via browser redirect -- there is no
-- session; the code + PKCE verifier together ARE the proof of identity,
-- exactly like verify_api_token's own bare-anon-client posture). Every
-- validation failure below raises the SAME message, 'invalid_grant' --
-- deliberately NOT distinguishing "code not found" from "already used"
-- from "expired" from "wrong client" from "wrong redirect_uri" from "PKCE
-- mismatch" to the caller (an oracle would let an attacker learn which
-- guess was closest) -- app/oauth/token/route.ts maps this straight
-- through as the OAuth `error` field verbatim (it IS already the correct
-- RFC 6749 error code for every one of these cases). A REJECTED exchange
-- does NOT burn the code (the transaction rolls back) -- see the inline
-- comment just above the client_id/redirect_uri checks below for why that
-- is deliberate, verified behavior, not an oversight.
create or replace function public.oauth_exchange_code(
  p_code text,
  p_client_id text,
  p_redirect_uri text,
  p_code_verifier text
)
returns table (access_token text, refresh_token text, expires_in integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code_hash text;
  v_row record;
  v_computed_challenge text;
  v_user_id uuid;
  v_client_name text;
  v_access_plain text;
  v_access_hash text;
  v_refresh_plain text;
  v_refresh_hash text;
  v_token_id text;
begin
  if p_code is null or p_client_id is null or p_redirect_uri is null or p_code_verifier is null then
    raise exception 'invalid_request';
  end if;

  v_code_hash := encode(extensions.digest(p_code, 'sha256'), 'hex');

  -- Atomic single-use consume: mirrors verify_api_token's TOCTOU-safe
  -- "UPDATE ... RETURNING" idiom exactly -- the WHERE clause's used_at IS
  -- NULL / expires_at check is evaluated against the row exactly once; a
  -- concurrent SECOND exchange of the SAME code either wins this race
  -- (first) or matches zero rows (second) -- it can never do both, and
  -- there is no window where a stale read could let a code be redeemed
  -- twice.
  update public.oauth_codes
  set used_at = now()
  where code_hash = v_code_hash
    and used_at is null
    and expires_at > now()
  returning client_id, user_id, redirect_uri, code_challenge
  into v_row;

  if not found then
    raise exception 'invalid_grant';
  end if;

  -- IMPORTANT, verified live (not just reasoned about): every `raise
  -- exception` below this point aborts the ENTIRE calling transaction (one
  -- RPC call = one transaction, PostgREST's own default) -- which ROLLS
  -- BACK the `used_at` stamp the UPDATE above just wrote, along with
  -- everything else in this function. So a REJECTED exchange (wrong
  -- client_id, wrong redirect_uri, or a PKCE mismatch below) does NOT burn
  -- the code -- it remains redeemable by whoever actually holds the
  -- correct client_id/redirect_uri/code_verifier triple, exactly as if the
  -- failed attempt never happened. This is deliberate, not an oversight:
  -- an attacker's wrong guess costs them nothing in extra leverage (256
  -- bits of code_verifier entropy makes guessing it infeasible regardless,
  -- and a random client_id/redirect_uri guess is equally infeasible), but
  -- it also must never let an attacker deny service to the legitimate
  -- holder by "using up" their code with a deliberately wrong guess.
  -- `used_at` becomes durably set ONLY when every check below (including
  -- the PKCE comparison) has ALSO passed and this function returns
  -- normally -- confirmed by inspecting oauth_codes.used_at directly after
  -- a rejected cross-client attempt (see PR notes: NULL immediately after
  -- the rejection, then successfully set once the legitimate holder
  -- redeemed the same code afterward).
  if v_row.client_id is distinct from p_client_id then
    raise exception 'invalid_grant';
  end if;

  if v_row.redirect_uri is distinct from p_redirect_uri then
    raise exception 'invalid_grant';
  end if;

  -- PKCE S256 verification, hand-rolled in SQL: base64url(sha256(
  -- code_verifier)) must equal the code_challenge recorded at
  -- /oauth/authorize time. `encode(..., 'base64')` + translate/rtrim is
  -- the base64url transform (same alphabet swap, same padding strip as
  -- lib/server/mcp-auth.ts's base64url() -- verified byte-for-byte
  -- equivalent against known RFC 7636 test vectors in the PR notes).
  v_computed_challenge := rtrim(translate(encode(extensions.digest(p_code_verifier, 'sha256'), 'base64'), '+/', '-_'), '=');
  if v_computed_challenge is distinct from v_row.code_challenge then
    raise exception 'invalid_grant';
  end if;

  v_user_id := v_row.user_id;

  select c.client_name into v_client_name from public.oauth_clients c where c.client_id = p_client_id;

  -- Mint the access + refresh token pair exactly like enable_report_share
  -- mints a share token: generate-in-SQL, hash for storage, return the
  -- plaintext exactly once -- never persisted anywhere in cleartext.
  v_access_plain := 'ffmcp_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_access_hash := encode(extensions.digest(v_access_plain, 'sha256'), 'hex');
  v_refresh_plain := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_refresh_hash := encode(extensions.digest(v_refresh_plain, 'sha256'), 'hex');
  v_token_id := 'tok_' || pg_catalog.gen_random_uuid()::text;  -- schema-qualified -- see oauth_register_client's identical note above

  insert into public.api_tokens (
    id, user_id, token_hash, label, kind, oauth_client_id,
    refresh_token_hash, expires_at, refresh_expires_at
  ) values (
    v_token_id, v_user_id, v_access_hash,
    coalesce(nullif(btrim(coalesce(v_client_name, '')), ''), 'Claude.ai connector'),
    'oauth', p_client_id, v_refresh_hash, now() + interval '30 days', now() + interval '90 days'
  );

  return query select v_access_plain, v_refresh_plain, extract(epoch from interval '30 days')::integer;
end;
$$;

comment on function public.oauth_exchange_code(text, text, text, text) is
  'Phase 8b. Unauthenticated (bare anon client) -- POST /oauth/token, grant_type=authorization_code. Atomically consumes a single-use code (TOCTOU-safe UPDATE...RETURNING, same idiom as verify_api_token), verifies client_id + redirect_uri + PKCE S256 all in one transaction, then mints a fresh api_tokens row (kind=''oauth'') and a rotating hashed refresh token, returning both plaintexts ONCE. Every failure raises the SAME ''invalid_grant'' message regardless of which check failed -- see this function''s own header comment for why that non-distinguishing behavior is deliberate.';

revoke all on function public.oauth_exchange_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.oauth_exchange_code(text, text, text, text) to anon;

-- =============================================================================
-- 7) oauth_refresh_token -- POST /oauth/token, grant_type=refresh_token.
-- =============================================================================
-- Rotation, in place: a successful refresh atomically overwrites BOTH the
-- access-token hash and the refresh-token hash on the SAME row (rather
-- than inserting a new row per refresh) -- the OLD refresh token
-- immediately stops matching anything (its hash was just replaced), so a
-- replay of an already-rotated refresh token fails the same way an
-- unknown one does: zero rows match, 'invalid_grant'. Requires the
-- presenting client_id to match the token's own oauth_client_id -- a
-- refresh token is bound to the client it was issued to, same as the
-- access token it pairs with.
create or replace function public.oauth_refresh_token(
  p_refresh_token text,
  p_client_id text
)
returns table (access_token text, refresh_token text, expires_in integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_access_plain text;
  v_access_hash text;
  v_new_refresh_plain text;
  v_new_refresh_hash text;
  v_updated_id text;
begin
  if p_refresh_token is null or p_client_id is null then
    raise exception 'invalid_request';
  end if;

  v_hash := encode(extensions.digest(p_refresh_token, 'sha256'), 'hex');
  v_access_plain := 'ffmcp_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_access_hash := encode(extensions.digest(v_access_plain, 'sha256'), 'hex');
  v_new_refresh_plain := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_new_refresh_hash := encode(extensions.digest(v_new_refresh_plain, 'sha256'), 'hex');

  update public.api_tokens
  set token_hash = v_access_hash,
      refresh_token_hash = v_new_refresh_hash,
      expires_at = now() + interval '30 days',
      refresh_expires_at = now() + interval '90 days',
      last_used_at = now()
  where kind = 'oauth'
    and oauth_client_id = p_client_id
    and refresh_token_hash = v_hash
    and revoked_at is null
    and refresh_expires_at > now()
  returning id into v_updated_id;

  if not found then
    raise exception 'invalid_grant';
  end if;

  return query select v_access_plain, v_new_refresh_plain, extract(epoch from interval '30 days')::integer;
end;
$$;

comment on function public.oauth_refresh_token(text, text) is
  'Phase 8b. Unauthenticated (bare anon client) -- POST /oauth/token, grant_type=refresh_token. Atomically rotates the presenting api_tokens row IN PLACE (new access-token hash + new refresh-token hash + extended expiries) -- the old refresh token stops matching anything the instant this succeeds, so replaying it fails identically to an unknown token (''invalid_grant''). Requires the presenting client_id to match the row''s own oauth_client_id.';

revoke all on function public.oauth_refresh_token(text, text) from public, anon, authenticated;
grant execute on function public.oauth_refresh_token(text, text) to anon;
