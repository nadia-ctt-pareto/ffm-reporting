// Phase 8b: handles the Approve/Deny decision from the consent screen
// (app/oauth/authorize/page.tsx + components/oauth/AuthorizeScreen.tsx).
// Deliberately a SEPARATE route from /oauth/authorize itself -- a page.tsx
// and a route.ts cannot share one path+method in the App Router, and the
// consent screen needs page.tsx (a real React tree with CSS Modules) for
// its GET render.
//
// NOT in middleware.ts's public list -- same auth wall as /oauth/authorize
// itself (a signed-out POST here 401s/redirects before ever reaching this
// handler); re-checked again below regardless (defense in depth, matching
// every other route handler's convention in this codebase -- see e.g.
// app/api/reports/route.ts's header comment).
//
// UNLIKE /oauth/register and /oauth/token (deliberately public,
// cross-origin-by-design endpoints with NO CSRF check at all -- see their
// own header comments), THIS endpoint DOES run `assertMutationAllowed`'s
// `Sec-Fetch-Site` check: it's a plain SAME-ORIGIN HTML `<form>`
// submission riding the signed-in user's own session cookie -- exactly the
// shape CSRF protects. A malicious external page auto-submitting a hidden
// form here (with an attacker's OWN client_id/redirect_uri/code_challenge)
// would otherwise silently mint a real authorization code bound to the
// signed-in victim's account, for an attacker-controlled OAuth client --
// a "login/consent-forcing CSRF" attack.
//
// Every hidden field from the consent form is RE-VALIDATED here against
// `oauth_clients` (client_id exists, redirect_uri is one of ITS registered
// URIs) -- never trusted just because the form round-tripped it. The
// SECURITY DEFINER RPC (`oauth_create_authorization_code`) re-validates
// AGAIN, independently, inside the same transaction that mints the code
// (belt-and-braces -- see that function's own comment).

import { NextResponse, type NextRequest } from 'next/server';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { assertMutationAllowed } from '@/lib/server/request-guards';
import { createServerSupabase } from '@/lib/supabase/server';

function redirectTo(url: URL): NextResponse {
  return NextResponse.redirect(url.toString(), { status: 302 });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const guardError = assertMutationAllowed(request);
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const form = await request.formData();
  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const codeChallenge = String(form.get('code_challenge') ?? '');
  const state = String(form.get('state') ?? '');
  const decision = String(form.get('decision') ?? '');

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Post-review nit (defense-in-depth): app/oauth/authorize/page.tsx
  // already refuses to render the consent form at all unless
  // code_challenge is present, so an empty value here should never happen
  // in practice -- but without this check, a tampered/blank hidden field
  // reached oauth_create_authorization_code's own validation and surfaced
  // as a generic `server_error` instead of a clean `invalid_request`.
  if (decision === 'approve' && !codeChallenge) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'code_challenge is required.' }, { status: 400 });
  }

  // Re-validate client_id/redirect_uri pairing again -- never trust a
  // hidden field just because /oauth/authorize itself rendered it (see
  // header comment).
  const { data: client, error: clientError } = await supabase
    .from('oauth_clients')
    .select('client_id, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();
  const registeredRedirectUris = (client?.redirect_uris as string[] | null) ?? [];
  if (clientError || !client || !registeredRedirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Unknown client or unregistered redirect_uri.' }, { status: 400 });
  }

  if (decision !== 'approve') {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    return redirectTo(url);
  }

  const { data: code, error } = await supabase.rpc('oauth_create_authorization_code', {
    p_client_id: clientId,
    p_redirect_uri: redirectUri,
    p_code_challenge: codeChallenge,
  });
  if (error || typeof code !== 'string') {
    console.error('[oauth/authorize/decision] oauth_create_authorization_code RPC error', error);
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'server_error');
    if (state) url.searchParams.set('state', state);
    return redirectTo(url);
  }

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return redirectTo(url);
}
