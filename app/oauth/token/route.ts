// Phase 8b: RFC 6749 §3.2/§6 token endpoint -- `authorization_code`
// exchange AND `refresh_token` rotation, each minting/rotating an
// `api_tokens` row (`kind='oauth'`) via a single atomic SECURITY DEFINER
// RPC (`oauth_exchange_code` / `oauth_refresh_token`,
// supabase/migrations/20260724000010_oauth.sql). Per the plan's "layering
// invariant": the token this mints authenticates against `/api/mcp`
// through the EXACT SAME `verify_api_token` -> mcp-auth.ts bridge as a
// Phase 8a bearer token, unmodified -- confirmed live (see PR notes: a
// token from this endpoint resolves via `verify_api_token` to the
// consenting user, same as any `ffmcp_` token from `POST /api/tokens`).
//
// Public, cross-origin, unauthenticated by protocol (RFC 6749 §3.2: the
// token endpoint is called directly by the client, never via browser
// redirect) -- no `Sec-Fetch-Site`/CSRF check (see app/oauth/register/
// route.ts's header comment for why that check doesn't apply to this
// class of endpoint), and deliberately uses the BARE anon client (never
// the cookie-bound one -- there is no session to bind to here; the
// code+verifier, or the refresh token, IS the proof of identity, exactly
// like `verify_api_token`'s own bare-anon-client posture in
// lib/server/mcp-auth.ts).
//
// `application/x-www-form-urlencoded`, NOT JSON -- verified directly
// against @modelcontextprotocol/sdk/client/auth.js's `executeTokenRequest`
// (every one of exchangeAuthorization/refreshAuthorization/fetchToken
// funnels through it): `client_id` rides in the BODY (RFC 6749 §2.3's
// "none" public-client auth method, `applyPublicAuth`), never a client
// secret (this AS never issues one -- see oauth_clients' table comment).
//
// `Cache-Control: no-store` on every response (success or error) -- RFC
// 6749 §5.1 REQUIRES it for responses that may carry a secret.

import { NextResponse, type NextRequest } from 'next/server';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { OAUTH_NO_STORE_HEADERS, mapOauthRpcErrorMessage } from '@/lib/server/oauth';
import { assertBodySize, MAX_BODY_BYTES, readTextBody } from '@/lib/server/request-guards';
import { getSupabaseAnonClient } from '@/lib/supabase/anon';

interface OauthTokenRow {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function oauthError(status: number, error: string, description?: string): NextResponse {
  return NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, { status, headers: OAUTH_NO_STORE_HEADERS });
}

/**
 * `server_error` is 500 -- it's `mapOauthRpcErrorMessage`'s fallback for a
 * genuinely unexpected (non-`ServiceError`-shaped) RPC failure, i.e. this
 * AS's own fault, not the client's. Note: RFC 6749 §5.2 doesn't actually
 * enumerate `server_error` for the TOKEN endpoint (it's a §4.1.2.1
 * AUTHORIZATION-endpoint redirect code) -- there is no clean equivalent in
 * the token-endpoint registry (invalid_request/invalid_client/invalid_grant/
 * unauthorized_client/unsupported_grant_type/invalid_scope), so this is a
 * widely-used, harmless extension value for "this wasn't your fault, we
 * broke," not a spec violation with a defined alternative.
 */
function statusForOauthError(error: string): number {
  return error === 'server_error' ? 500 : 400;
}

function tokenResponse(row: OauthTokenRow): NextResponse {
  return NextResponse.json(
    { access_token: row.access_token, token_type: 'Bearer', expires_in: row.expires_in, refresh_token: row.refresh_token, scope: 'read write' },
    { headers: OAUTH_NO_STORE_HEADERS }
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sizeError = assertBodySize(request);
  if (sizeError) return sizeError;

  const bodyResult = await readTextBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  const params = new URLSearchParams(bodyResult.text);
  const grantType = params.get('grant_type');
  const clientId = params.get('client_id');
  // Post-review fix (RFC 6749 §5.2): a MISSING required parameter is
  // `invalid_request`; `unsupported_grant_type` is specifically for a
  // `grant_type` value that's present but not one this AS implements --
  // these used to be conflated (a missing `grant_type` fell through to the
  // `unsupported_grant_type` branch at the bottom of this function).
  if (!grantType) return oauthError(400, 'invalid_request', 'grant_type is required.');
  if (!clientId) return oauthError(400, 'invalid_request', 'client_id is required.');

  const anon = getSupabaseAnonClient();

  if (grantType === 'authorization_code') {
    const code = params.get('code');
    const redirectUri = params.get('redirect_uri');
    const codeVerifier = params.get('code_verifier');
    if (!code || !redirectUri || !codeVerifier) {
      return oauthError(400, 'invalid_request', 'code, redirect_uri, and code_verifier are required.');
    }

    const { data, error } = await anon.rpc('oauth_exchange_code', {
      p_code: code,
      p_client_id: clientId,
      p_redirect_uri: redirectUri,
      p_code_verifier: codeVerifier,
    });
    if (error || !Array.isArray(data) || data.length === 0) {
      const mapped = mapOauthRpcErrorMessage(error?.message);
      if (mapped === 'server_error') console.error('[oauth/token] oauth_exchange_code RPC error', error);
      return oauthError(statusForOauthError(mapped), mapped, 'The authorization code could not be exchanged.');
    }
    return tokenResponse(data[0] as OauthTokenRow);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = params.get('refresh_token');
    if (!refreshToken) return oauthError(400, 'invalid_request', 'refresh_token is required.');

    const { data, error } = await anon.rpc('oauth_refresh_token', {
      p_refresh_token: refreshToken,
      p_client_id: clientId,
    });
    if (error || !Array.isArray(data) || data.length === 0) {
      const mapped = mapOauthRpcErrorMessage(error?.message);
      if (mapped === 'server_error') console.error('[oauth/token] oauth_refresh_token RPC error', error);
      return oauthError(statusForOauthError(mapped), mapped, 'The refresh token could not be used.');
    }
    return tokenResponse(data[0] as OauthTokenRow);
  }

  return oauthError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
}
