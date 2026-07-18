// Shared open-redirect guard for the `?next=` param threaded through
// /login -> signInWithOtp's emailRedirectTo -> /auth/confirm -> the final
// post-login destination. Hoisted into one module (was previously two
// byte-identical copies in components/auth/LoginScreen.tsx and
// app/auth/confirm/route.ts) specifically so a future fix can't drift back
// out of sync between them.
//
// Post-review fix: the original implementation (`next.startsWith('/') &&
// !next.startsWith('//')`) is pattern-matching, and a backslash defeats it.
// `/\evil.com` starts with `/`, is not `//`, so it passed -- but
// `new URL('/\\evil.com', origin)` resolves to `http://evil.com/`, because
// the WHATWG URL spec normalizes a leading `\` to `/` when parsing a
// relative reference, so the browser (and `next.js`'s own router) treats
// `/\evil.com` as protocol-relative too. Verified exploitable end-to-end:
// `/login?next=/\evil.com` -> GoTrue's redirect allow-list matches
// `/auth/confirm` ignoring the query string -> the magic-link email
// legitimately arrives -> clicking it lands the victim on evil.com with a
// real, valid session already established against THIS app (the redirect
// happens after auth succeeds, not before) -- a phishing primitive, not
// just a cosmetic bug. `/\/evil.com`, `/\t/evil.com`, `/\n//evil.com` are
// all variants of the same defeat.
//
// Fix: stop pattern-matching path syntax; parse `next` as a URL against an
// inert placeholder base and compare the RESOLVED origin, exactly the way
// a browser would resolve it. Anything that doesn't resolve back to that
// same placeholder origin (a scheme, `//host`, or a backslash-smuggled
// host) is rejected outright.
const PLACEHOLDER_ORIGIN = 'http://safe-next-placeholder.invalid';

/**
 * Post-review fix (S5): the post-login destination no longer rides along
 * on `emailRedirectTo`/GoTrue's `.RedirectTo` template variable at all --
 * that mechanism is fundamentally fragile (GoTrue validates
 * `emailRedirectTo` against `additional_redirect_urls`, matched ignoring
 * the query string, and SILENTLY substitutes bare `site_url` -- no path, no
 * query string -- if it doesn't match; a template built from `.RedirectTo`
 * is then malformed the moment that happens, e.g. one config.toml edit that
 * forgets to keep `/auth/confirm` allow-listed). Instead,
 * `components/auth/LoginScreen.tsx` stashes `next` in this short-lived,
 * same-origin cookie BEFORE calling `signInWithOtp` (with a query-string-
 * free, always-exact-match `emailRedirectTo` of just `{origin}/auth/confirm`),
 * and `app/auth/confirm/route.ts` reads it back after the token verifies --
 * both in the SAME browser, matching the login page's own "Open it on this
 * device to continue" copy. 10-minute expiry (comfortably longer than the
 * OTP's own default 1h validity is irrelevant here -- this is bounded by how
 * long a person takes to check their email, not the token's own lifetime).
 */
export const POST_LOGIN_NEXT_COOKIE = 'ff-post-login-next';

export function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  try {
    const resolved = new URL(next, PLACEHOLDER_ORIGIN);
    if (resolved.origin !== PLACEHOLDER_ORIGIN) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return '/';
  }
}
