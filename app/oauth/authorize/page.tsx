import { redirect } from 'next/navigation';
import { AuthorizeScreen } from '@/components/oauth/AuthorizeScreen';
import { isMcpConfigured } from '@/lib/server/mcp-auth';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * `/oauth/authorize` -- deliberately INSIDE the middleware auth wall (NOT
 * added to middleware.ts's public list, unlike this phase's other 4 OAuth
 * endpoints): an unauthenticated hit redirects to
 * `/login?next=/oauth/authorize?<original query>` (middleware.ts now
 * carries the query string through `next`, a small necessary fix -- see
 * that file's own comment on the change) and, after a real password
 * sign-in, lands back here with the exact same params -- "sign in with
 * your existing account to authorize" falls out of the existing login
 * flow for free, per the approved plan.
 *
 * A real React Server Component (not a hand-rolled `Response`, unlike the
 * other 4 OAuth routes) -- doing server-side Supabase reads directly from
 * a page component is an established pattern in this codebase already
 * (see `app/reports/[id]/present/page.tsx`'s `resolveShared`, which calls
 * `getSupabaseAnonClient()`/`getSharedReport` directly). Consistent with
 * that precedent, this page fetches/validates everything itself so the
 * consent screen can share `components/auth/LoginScreen.module.css`'s
 * design-token styling (a raw `Response` built by hand has no bundler-
 * resolved CSS Modules to reach for).
 *
 * TWO-STAGE VALIDATION (OAuth Security BCP, not just this repo's own
 * convention): errors raised BEFORE `redirect_uri` is verified against the
 * CLIENT'S OWN registered set render an inline error page (NEVER a
 * redirect) -- redirecting to an unverified URI is exactly the
 * code-exfiltration primitive this whole design defends against. Only
 * once `client_id` + `redirect_uri` are BOTH confirmed valid for each
 * other can a later error (bad `response_type`, missing/non-S256 PKCE
 * challenge) safely bounce back to that redirect_uri with `?error=...`.
 *
 * The Approve/Deny buttons are a plain HTML
 * `<form method="POST" action="/oauth/authorize/decision">` (see
 * components/oauth/AuthorizeScreen.tsx) -- posting to a SEPARATE route,
 * because a `page.tsx` and a `route.ts` cannot coexist at the same
 * path+method in the App Router; that route re-validates every hidden
 * field again server-side rather than trusting this round-trip.
 */
export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isMcpConfigured()) {
    return <AuthorizeScreen status="error" title="Not Available" message="Claude connector access isn't configured on this server." />;
  }

  const params = await searchParams;
  const clientId = firstParam(params.client_id);
  const redirectUriParam = firstParam(params.redirect_uri);
  const responseType = firstParam(params.response_type);
  const codeChallenge = firstParam(params.code_challenge);
  const codeChallengeMethod = firstParam(params.code_challenge_method);
  const state = firstParam(params.state);

  if (!clientId || !redirectUriParam) {
    return (
      <AuthorizeScreen
        status="error"
        title="Invalid Request"
        message="This link is missing required parameters. Ask the application you're connecting to try the connection again."
      />
    );
  }

  const supabase = await createServerSupabase();
  const { data: client, error: clientError } = await supabase
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();

  if (clientError || !client) {
    return (
      <AuthorizeScreen
        status="error"
        title="Unknown Application"
        message="This application hasn't registered with this server. Ask it to try the connection again."
      />
    );
  }

  const registeredRedirectUris = (client.redirect_uris as string[] | null) ?? [];
  if (!registeredRedirectUris.includes(redirectUriParam)) {
    return (
      <AuthorizeScreen
        status="error"
        title="Redirect Address Not Allowed"
        message="The redirect address this request specified doesn't match what this application registered. For your safety, this request has been stopped."
      />
    );
  }

  // From here on, redirectUriParam is verified safe to bounce error
  // responses back to (see this file's own header comment).
  if (responseType !== 'code') {
    redirectWithError(redirectUriParam, state, 'unsupported_response_type', 'Only the authorization code flow is supported.');
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    redirectWithError(redirectUriParam, state, 'invalid_request', 'PKCE with S256 (code_challenge_method=S256) is required.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Middleware already redirects an unauthenticated request to /login
    // before this Server Component ever runs -- this is defense in depth
    // only (e.g. a session that expired in the instant between middleware
    // and this render).
    return <AuthorizeScreen status="error" title="Sign-In Required" message="Please sign in and try the connection again." />;
  }

  return (
    <AuthorizeScreen
      status="consent"
      clientName={client.client_name || client.client_id}
      userEmail={user.email ?? ''}
      clientId={clientId}
      redirectUri={redirectUriParam}
      codeChallenge={codeChallenge}
      state={state}
    />
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function redirectWithError(redirectUri: string, state: string, error: string, description: string): never {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  redirect(url.toString());
}
