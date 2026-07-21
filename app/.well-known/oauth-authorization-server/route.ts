// Phase 8b: RFC 8414 OAuth 2.0 Authorization Server Metadata. This app IS
// its own minimal Authorization Server (Supabase Auth's password-login
// session is reused for /oauth/authorize's login step, but Supabase Auth
// itself exposes no general-purpose OAuth AS surface this app's users are
// meant to drive -- see the approved plan's "OAuth for claude.ai" section).
//
// Hand-rolled (mcp-handler ships no AS-metadata helper, only the
// protected-resource one above) but every field name/shape matches
// `@modelcontextprotocol/sdk/shared/auth.js`'s `OAuthMetadataSchema`
// exactly -- verified by reading that schema directly, not guessed from
// the RFC alone, since claude.ai's connector (and
// `npx @modelcontextprotocol/inspector`) parse this response through that
// exact zod schema.
//
// PKCE S256 is the ONLY supported challenge method
// (`code_challenge_methods_supported: ['S256']`) -- 'plain' is never
// advertised, and app/oauth/authorize rejects it even if a client sends it
// anyway. Public client only (`token_endpoint_auth_methods_supported:
// ['none']`) -- no client secret is ever issued (see oauth_clients' table
// comment, supabase/migrations/20260724000010_oauth.sql).
//
// Post-review BLOCKER fix: `issuer`/`authorization_endpoint`/`token_endpoint`/
// `registration_endpoint` are no longer built from `getPublicOrigin(request)`
// (trusts `X-Forwarded-Host` unconditionally) -- `lib/server/oauth.ts`'s
// `getIssuerOrigin()` prefers the pinned, server-only `APP_ORIGIN` env var,
// falling back to the request-derived origin only when unset (local dev).
// `Cache-Control` is now `no-store` (was `max-age=3600`) -- see
// `getIssuerOrigin`'s own comment for the full host-header cache-poisoning
// chain this closes (a spoofed forwarded-host header could otherwise have
// poisoned a CACHED response into advertising a `token_endpoint` on an
// attacker's origin, and claude.ai would send a victim's real code + PKCE
// verifier there).
//
// Public + gated identically to the protected-resource endpoint above.

import { NextResponse } from 'next/server';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { getIssuerOrigin } from '@/lib/server/oauth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function GET(request: Request): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const origin = getIssuerOrigin(request);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
    },
    { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
  );
}

export function OPTIONS(): Response {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}
