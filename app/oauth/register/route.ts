// Phase 8b: RFC 7591 Dynamic Client Registration. claude.ai's connector
// setup calls this BEFORE any user is ever asked to sign in -- verified
// against @modelcontextprotocol/sdk/client/auth.js's `registerClient`: a
// plain `POST`, `Content-Type: application/json`, no auth. Deliberately
// public (middleware.ts) and unauthenticated -- there is no session to
// bind a client REGISTRATION to; a "client" here is a claude.ai connector
// installation, not a user.
//
// THE primary control against DCR being turned into a code-exfiltration
// channel: every redirect_uri must resolve (real URL parsing, not string
// matching -- lib/server/oauth.ts's `isAllowedRedirectUri`) to
// https://claude.ai or https://claude.com (or a subdomain of either). A
// SECOND, independent layer enforces the exact same rule inside
// `public.oauth_register_client()` itself (supabase/migrations/
// 20260724000010_oauth.sql) -- see that function's comment for why
// duplicating this is deliberate, not drift. Do not weaken either layer.
//
// No `Sec-Fetch-Site`/CSRF check here (unlike every `app/api/reports*`
// mutating route) -- this endpoint is MEANT to be called cross-origin, by
// claude.ai's own infrastructure, not by this app's own frontend. CSRF
// protection defends a session cookie from being ridden by a forged
// request; there is no session/cookie here at all -- registering a client
// creates a public, non-secret record, not a user action.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { isAllowedRedirectUri } from '@/lib/server/oauth';
import { assertBodySize, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { getSupabaseAnonClient } from '@/lib/supabase/anon';

const RegisterRequestSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().max(200).optional(),
});

interface OauthRegisterClientRow {
  client_id: string;
  created_at: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sizeError = assertBodySize(request);
  if (sizeError) return sizeError;

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = RegisterRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'redirect_uris (a non-empty array of URL strings) is required.' },
      { status: 400 }
    );
  }

  const badRedirect = parsed.data.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
  if (badRedirect) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https://claude.ai or https://claude.com URLs.' },
      { status: 400 }
    );
  }

  const anon = getSupabaseAnonClient();
  const { data, error } = await anon.rpc('oauth_register_client', {
    p_client_name: parsed.data.client_name ?? null,
    p_redirect_uris: parsed.data.redirect_uris,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    console.error('[oauth/register] oauth_register_client RPC error', error);
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'Registration failed.' }, { status: 400 });
  }

  const row = data[0] as OauthRegisterClientRow;
  return NextResponse.json(
    {
      client_id: row.client_id,
      client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
      redirect_uris: parsed.data.redirect_uris,
      client_name: parsed.data.client_name,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  );
}
