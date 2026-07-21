// Phase 8b: RFC 9728 OAuth 2.0 Protected Resource Metadata. `withMcpAuth`'s
// 401 `WWW-Authenticate` header (app/api/[transport]/route.ts, UNCHANGED by
// this phase) already points here by default
// (`resourceMetadataPath: '/.well-known/oauth-protected-resource'`) -- this
// is the endpoint that default resolves to.
//
// Delegates the RFC 9728 JSON SHAPE to `mcp-handler`'s own
// `protectedResourceHandler` (confirmed present in the pinned
// mcp-handler@1.1.0's exports) -- it already matches
// `@modelcontextprotocol/sdk/shared/auth.js`'s `OAuthProtectedResourceMetadataSchema`
// byte-for-byte, since it ships from the same vendor.
//
// Post-review BLOCKER fix: the ORIGIN is no longer taken verbatim from
// `getPublicOrigin(request)` (which trusts `X-Forwarded-Host` unconditionally)
// -- `lib/server/oauth.ts`'s `getIssuerOrigin()` prefers the pinned,
// server-only `APP_ORIGIN` env var and only falls back to the request-derived
// origin when that's unset (local dev). Combined with the `no-store` below
// (was `max-age=3600`), a spoofed forwarded-host header can no longer poison
// a CACHED metadata response into advertising a `resource`/`authorization_servers`
// value pointing at an attacker's origin -- see that function's own comment
// for the full exploit chain this closes and `.env.example`'s `APP_ORIGIN`
// block for what must be set in production.
//
// Public (middleware.ts's public list) -- this metadata must be readable
// by an unauthenticated MCP client before it has ANY token. 404s (matching
// every other app/api/**-style demo-mode convention) when MCP isn't
// configured -- functionally equivalent to /api/mcp being 404 in that same
// state.

import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { NextResponse } from 'next/server';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { getIssuerOrigin } from '@/lib/server/oauth';

export async function GET(request: Request): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const origin = getIssuerOrigin(request);
  const handler = protectedResourceHandler({ authServerUrls: [origin], resourceUrl: `${origin}/api/mcp` });
  const response = await handler(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
