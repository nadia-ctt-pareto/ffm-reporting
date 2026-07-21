// Phase 8b: shared helpers for the 5 hand-rolled OAuth 2.1 endpoints
// (app/.well-known/oauth-*, app/oauth/register, app/oauth/authorize[/decision],
// app/oauth/token). Kept alongside lib/server/mcp-auth.ts but deliberately a
// SEPARATE module -- per the plan's "layering invariant," an OAuth access
// token is just another api_tokens row flowing through the SAME
// verify_api_token -> HS256-JWT-mint bridge mcp-auth.ts already implements;
// that file needed ZERO changes for this phase (confirmed live: verify_api_token
// looks up purely by token_hash, indifferent to how a row was issued -- see
// supabase/migrations/20260724000010_oauth.sql's header comment). This module
// is the ISSUANCE side only -- it never mints an MCP JWT and never
// constructs a user-scoped Supabase client.

import { getPublicOrigin } from 'mcp-handler';

/**
 * Post-review BLOCKER fix: the two `.well-known` routes used to build
 * `issuer`/`authorization_endpoint`/`token_endpoint`/`registration_endpoint`/
 * `authServerUrls`/`resourceUrl` straight from `getPublicOrigin(request)`,
 * which trusts `X-Forwarded-Host`/`X-Forwarded-Proto`/`Forwarded`
 * UNCONDITIONALLY. Combined with those responses being cacheable
 * (`max-age=3600`, now fixed to `no-store` -- see those routes), a spoofed
 * forwarded-host header could have poisoned a cached metadata response into
 * advertising `token_endpoint: https://evil.com/oauth/token` -- claude.ai
 * would then send a victim's real authorization code + PKCE verifier
 * straight to the attacker's server. `APP_ORIGIN` (server-only env var,
 * see `.env.example`) PINS the issuer/resource origin in any environment
 * where it's set (required in production -- see that file's comment);
 * `getPublicOrigin(request)` is used ONLY as a local-dev fallback when
 * `APP_ORIGIN` is unset, matching every other env-gated feature in this
 * codebase (demo mode, BYOK, etc.) -- never silently trusting the request
 * in a configuration where a pinned value was expected but forgotten.
 */
export function getIssuerOrigin(request: Request): string {
  const pinned = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '');
  if (pinned) return pinned;
  return getPublicOrigin(request);
}

/**
 * DCR redirect_uri allowlist -- THE primary control against dynamic client
 * registration being turned into a code-exfiltration channel (an attacker
 * registering their OWN redirect_uri would receive the authorization code,
 * and via a captured/guessed code_verifier, potentially the token, meant
 * for a legitimate claude.ai session). Real WHATWG URL parsing, not string/
 * regex matching -- correctly rejects userinfo-smuggled hosts (e.g.
 * `new URL('https://claude.ai@evil.com/x').hostname` is `'evil.com'`, not
 * `'claude.ai'`) and scheme confusion.
 *
 * Rejects a non-empty `port` and any `username`/`password` (userinfo) --
 * post-review fix: this predicate used to be LOOSER than the SQL mirror
 * (`public.oauth_redirect_uris_allowlisted()`, which has no port-matching
 * group in its regex and so rejects any `:port` outright), meaning a URI
 * this function passed could still be rejected at the SQL layer with a
 * generic `invalid_client_metadata` "Registration failed." instead of the
 * specific `invalid_redirect_uri` this route means to return. claude.ai
 * uses neither a port nor userinfo in its real callback URLs, so this is
 * purely an error-clarity fix, not a security change -- the SQL layer was
 * already the stricter, winning predicate either way. Both predicates now
 * agree exactly; do not let them drift apart again.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return host === 'claude.ai' || host.endsWith('.claude.ai') || host === 'claude.com' || host.endsWith('.claude.com');
}

/** RFC 6749 §5.1/§5.2 REQUIRE `Cache-Control: no-store` on every token
 * endpoint response (success or error) -- the body carries a secret
 * (an access/refresh token, or diagnostic detail about a failed grant). */
export const OAUTH_NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

/**
 * The only OAuth `error` codes this Authorization Server ever produces on
 * purpose (RFC 6749 §5.2 plus `server_error`, used for a genuinely
 * unexpected failure). `app/oauth/token/route.ts` maps any OTHER message
 * (a raw, un-normalized Postgres error) to `server_error` rather than ever
 * echoing it verbatim -- matching `lib/server/reports-service.ts`'s
 * `curatedMessage` ethos: never trust a raw error message unless it came
 * from a known-safe, hand-written, enumerated set.
 *
 * Post-review fix: `invalid_client` was previously listed here but never
 * actually raised by anything this codebase calls (`oauth_exchange_code`/
 * `oauth_refresh_token` only ever raise `'invalid_request'`/
 * `'invalid_grant'`) -- a dead code path, and RFC 6749 §5.2's own guidance
 * for `invalid_client` (HTTP 401, only when the client attempted
 * authentication) doesn't cleanly apply to this AS anyway (every client
 * here is public -- `token_endpoint_auth_methods_supported: ['none']` --
 * there is no client authentication attempt to fail). Removed rather than
 * mis-statused at 400.
 */
export const KNOWN_OAUTH_ERRORS = new Set(['invalid_request', 'invalid_grant', 'unsupported_grant_type', 'invalid_client_metadata']);

export function mapOauthRpcErrorMessage(message: string | undefined): string {
  if (message && KNOWN_OAUTH_ERRORS.has(message)) return message;
  return 'server_error';
}
