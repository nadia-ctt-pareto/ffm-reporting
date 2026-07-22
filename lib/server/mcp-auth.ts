// Phase 8a: the ENTIRE MCP auth bridge lives in this one file (+ the ONE
// SQL function it calls, `verify_api_token`, supabase/migrations/
// 20260721000007_mcp_tokens.sql) -- see CLAUDE.md's "Data plane (Phase 7b)"
// for the `reports-service` contract this hands a client into, and the
// approved Phase 8 plan's "auth-to-Supabase-client bridge" section for the
// full security argument this module implements. Confining every privilege
// elevation to one file + one SQL function is the entire point: there is
// exactly one place to audit, and no other module in this codebase mints a
// JWT or constructs a Supabase client from a bearer token.
//
// Mechanism, per inbound MCP request (see `verifyMcpAuth`, the
// `withMcpAuth`-shaped adapter `app/api/[transport]/route.ts` wires up):
//   1. `withMcpAuth` (mcp-handler) has already extracted
//      `Authorization: Bearer ffmcp_<token>` for us -- see that route's own
//      comment.
//   2. `verifyApiToken` calls `verify_api_token(p_token)` (a SECURITY
//      DEFINER RPC) via the BARE anon client (lib/supabase/anon.ts, never
//      the cookie-bound one -- an MCP request carries no session cookie at
//      all). The RPC hashes the token, looks it up, rejects a revoked/
//      expired match, stamps `last_used_at`, and returns the owning
//      `user_id` (or NULL for anything else -- missing, garbage, revoked,
//      expired; this module never learns WHICH, by design, see
//      `bridgeMcpToken`'s doc comment).
//   3. `mintMcpJwt` mints a 5-minute HS256 JWT signed with the project's
//      legacy JWT secret (server-only env `SUPABASE_JWT_SECRET`), claims
//      `{ sub: user_id, role: 'authenticated', aud: 'authenticated',
//      iss: '<SUPABASE_URL>/auth/v1', iat, exp }`, PLUS (WP3) a top-level
//      `org_read` boolean claim, set to whatever `api_tokens.org_read` says
//      for the token that was just verified. Deliberately NO
//      `app_metadata` -- `public.is_admin()`/`public.has_role_at_least()`
//      (supabase/migrations/20260719000004_auth_ownership.sql,
//      20260726000015_role_ladder.sql) read `auth.jwt() -> 'app_metadata'
//      ->> 'role'`, which is simply absent from every token this module
//      mints, so both evaluate `false`/`'member'`-rank unconditionally.
//      Every MCP call therefore runs as a plain member, even for an admin
//      user's token -- least privilege, documented in the Skill
//      (skills/weekly-reports/SKILL.md) and in McpAccessSection.tsx's copy.
//      `org_read` lives OUTSIDE `app_metadata` specifically so it can never
//      be read by `is_admin()`/`has_role_at_least()` and can never elevate
//      a token's WRITE authority -- `public.token_has_org_read()`
//      (supabase/migrations/20260726000018_scoped_access.sql) is the only
//      thing that reads it, and only `reports_select`/`tasks_select`/
//      `risks_select`/`priorities_select` reference that function, never
//      any insert/update/delete policy. An org-read token can therefore see
//      every report/task/risk/priority in the org (the same breadth
//      `list_reports`/`get_report`/`get_week_rollup` already advertised as
//      "org-wide" before WP3 scoped reads by default), but still writes
//      strictly as its own owner, identically to a non-org-read token.
//   4. `userScopedClient` builds a fresh `SupabaseClient` carrying that JWT
//      as its `Authorization` header (`persistSession`/`autoRefreshToken`
//      both false -- this client never establishes or refreshes a session,
//      it just presents one bearer token per request). THIS is the
//      user-scoped client every MCP tool body (lib/server/mcp-tools.ts)
//      runs its `reports-service` calls through.
//
// Security argument, explicit (mirrors the plan verbatim): PostgREST
// validates the JWT signature and sets `auth.uid() = sub`; `sub` can only
// ever be the uuid `verify_api_token` returned for that EXACT token hash;
// therefore every query this bridge's client makes runs as the
// `authenticated` role under the IDENTICAL RLS as the web cookie path --
// same role, same policies, same RPCs (`replace_reports` is SECURITY
// INVOKER, so its `coalesce(owner_id, auth.uid())` owner-stamping applies
// here exactly as it does for a browser session). `is_admin()` is false by
// construction (step 3 above). No service-role key exists anywhere in this
// module, this file's imports, or `lib/server/reports-service.ts` -- an MCP
// write can only ever touch rows the token's own user owns, with the same
// strength as the web path's RLS, because it IS the web path's RLS.
//
// Documented caveat (not solved here, not solvable without a schema/infra
// change): if this Supabase project's legacy JWT secret is ever fully
// revoked (ES256-only signing keys), `mintMcpJwt` keeps minting tokens that
// PostgREST will reject with a plain 401 -- there is no in-app fallback.
// Acceptable for a 2-10 person internal tool; the alternative (registering
// this app's own ES256 keypair via Supabase third-party-auth JWKS) is not
// built in Phase 8a.

import { createHash, createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getSupabaseAnonClient } from '../supabase/anon';
import { isSupabaseConfigured } from '../supabase/config';

/** Server-only env, deliberately NOT `NEXT_PUBLIC_*` (never shipped to the client bundle) -- see .env.example's block for where to find the local value (`supabase status`'s "JWT secret"). */
function jwtSecret(): string | undefined {
  return process.env.SUPABASE_JWT_SECRET;
}

/**
 * `/api/[transport]/route.ts` 404s the whole MCP endpoint unless this is
 * true -- Supabase configured (so there is a Postgres to bridge into) AND
 * `SUPABASE_JWT_SECRET` present (so a JWT can actually be minted). Demo mode
 * (no Supabase) already had no per-user ownership to bridge into at all;
 * Supabase-mode-without-the-secret is a genuine, distinct misconfiguration
 * this predicate also has to catch (a JWT-less bridge can authenticate a
 * bearer token but can never mint anything PostgREST would accept).
 */
export function isMcpConfigured(): boolean {
  return isSupabaseConfigured() && Boolean(jwtSecret());
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Hand-rolled HS256 signer (~10 lines) -- no `jose`/`jsonwebtoken`
 * dependency, matching this repo's dependency-light ethos (see CLAUDE.md's
 * hand-rolled CSV parser for the same posture). A JWT is just
 * `base64url(header) + '.' + base64url(payload) + '.' +
 * base64url(HMAC-SHA256(header + '.' + payload, secret))` -- there is
 * nothing here beyond that.
 */
function signHs256(claims: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

/** 5 minutes -- short-lived by design: this JWT only ever needs to live for the duration of ONE MCP tool call's Supabase queries, never persisted or reused across requests. */
const JWT_TTL_SECONDS = 5 * 60;

/** Mints the short-lived, PostgREST-compatible JWT for `userId` -- see this file's header comment for the full claim set (including the WP3 `org_read` claim) and why `app_metadata` is deliberately absent. */
function mintMcpJwt(userId: string, orgRead: boolean): string {
  const secret = jwtSecret();
  if (!secret) {
    throw new Error('mintMcpJwt() called without SUPABASE_JWT_SECRET set -- callers must check isMcpConfigured() first.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${url}/auth/v1`,
    iat,
    exp: iat + JWT_TTL_SECONDS,
    // WP3: a top-level (NOT app_metadata-nested) claim -- see this file's
    // header comment for why that placement is what keeps it isolated from
    // is_admin()/has_role_at_least() and from ever widening write authority.
    org_read: orgRead,
  };
  return signHs256(claims, secret);
}

/**
 * The sha-256 hex a token hashes to for storage/lookup -- the SINGLE TS-side
 * implementation of this, reused by `app/api/tokens/route.ts`'s POST
 * (computing `token_hash` before insert) so there is exactly one place in
 * this codebase that decides "how do we hash a token," matching
 * `verify_api_token`'s SQL-side `encode(extensions.digest(p_token,
 * 'sha256'), 'hex')` byte-for-byte (see that migration's own comment).
 */
export function hashApiTokenForStorage(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** WP3: `verify_api_token`'s widened jsonb return shape (supabase/migrations/20260726000018_scoped_access.sql) -- `user_id` (snake_case, exactly as the RPC returns it) plus the new `org_read` scope flag. */
interface VerifyApiTokenResult {
  user_id: string;
  org_read: boolean;
}

/**
 * Calls `verify_api_token` via the BARE anon client (never the cookie-bound
 * one -- see this file's header comment). Returns the owning `user_id` plus
 * its `org_read` scope, or `null` for ANY failure -- missing/malformed row,
 * revoked, expired, or a genuine RPC error (logged server-side either way,
 * never surfaced to the caller beyond "invalid").
 */
async function verifyApiToken(token: string): Promise<{ userId: string; orgRead: boolean } | null> {
  const anon = getSupabaseAnonClient();
  const { data, error } = await anon.rpc('verify_api_token', { p_token: token });
  if (error) {
    console.error('[mcp-auth] verify_api_token RPC error', error);
    return null;
  }
  const result = (data as VerifyApiTokenResult | null) ?? null;
  if (!result) return null;
  return { userId: result.user_id, orgRead: Boolean(result.org_read) };
}

/** The user-scoped client every MCP tool runs its `reports-service` calls through -- see this file's header comment. A fresh client per call, never a module-scope singleton (mirrors lib/supabase/anon.ts's own rationale: there is no persistent tab to amortize a singleton across here either). */
function userScopedClient(jwt: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface McpAuthContext {
  userId: string;
  db: SupabaseClient;
}

/** `ffmcp_` + 32 random bytes (base64url) -- see app/api/tokens/route.ts's POST for where this shape is minted. Checked here purely as a cheap, pre-network-call rejection of an obviously-malformed bearer value (the RPC itself doesn't care -- a garbage token just fails to hash-match any row and returns NULL either way; this only saves a wasted round-trip). */
const TOKEN_PREFIX = 'ffmcp_';

/**
 * The full bridge, called once per inbound MCP request (see `verifyMcpAuth`
 * below). Returns `null` for ANY failure -- missing/malformed prefix,
 * garbage token, revoked, expired, RPC error -- `verifyMcpAuth` turns every
 * one of those into the SAME uniform 401 via `withMcpAuth`; this module
 * deliberately never distinguishes "revoked" from "garbage" to the MCP
 * client (the difference is diagnostic-only, already logged server-side
 * inside `verifyApiToken`).
 */
export async function bridgeMcpToken(token: string): Promise<McpAuthContext | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const verified = await verifyApiToken(token);
  if (!verified) return null;
  const jwt = mintMcpJwt(verified.userId, verified.orgRead);
  return { userId: verified.userId, db: userScopedClient(jwt) };
}

/**
 * The exact `verifyToken` shape `mcp-handler`'s `withMcpAuth` expects:
 * `(req, bearerToken?) => AuthInfo | undefined | Promise<AuthInfo |
 * undefined>` -- `app/api/[transport]/route.ts` wires this in directly.
 * `AuthInfo.extra` (a `Record<string, unknown>`, per the SDK's own type) is
 * where the bridged `{ userId, db }` rides through to every tool handler's
 * `extra.authInfo` -- see `lib/server/mcp-tools.ts`'s `requireAuth`, the
 * only place that reads it back out. `scopes: ['read', 'write']` is a
 * single implicit full-access scope (Phase 8a issues no scoped tokens --
 * see the plan's "Scopes" note); `token`/`clientId` are populated for
 * `AuthInfo`'s own shape but nothing in this codebase currently reads them
 * back.
 */
export async function verifyMcpAuth(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const ctx = await bridgeMcpToken(bearerToken);
  if (!ctx) return undefined;
  return {
    token: bearerToken,
    clientId: ctx.userId,
    scopes: ['read', 'write'],
    extra: { userId: ctx.userId, db: ctx.db },
  };
}
