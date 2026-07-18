// Phase 7a: shared "is Supabase configured" check. This is the single
// predicate the repository factory (Phase 7b), `middleware.ts`, `lib/
// supabase/client.ts`/`server.ts`, and the sidebar's session footer all
// consult -- absence of BOTH `NEXT_PUBLIC_SUPABASE_URL` and
// `NEXT_PUBLIC_SUPABASE_ANON_KEY` means "demo mode": no auth, localStorage
// seeds, Phase 1-6 flows unchanged.
//
// Requires BOTH values, not just the URL (fixed post-review): a
// half-configured pair (URL set, key blank -- verified reproducible via a
// verbatim `cp .env.example .env.local` before .env.example's own values
// were fixed to ship fully commented-out) previously read as "configured"
// here, so `createBrowserClient`/`createServerClient` were called with an
// empty key and threw `"Your project's URL and Key are required..."` at
// module-eval time -- crashing EVERY route with a 500, including `/login`,
// with no in-app recovery. Treating a half-configured pair as demo mode
// (rather than a hard crash) is safe specifically because Phase 7a's
// repository factory still always returns `LocalStorageReportsRepository`
// (see lib/data/index.ts) -- there is no remote data a misconfigured
// client could accidentally leave unprotected yet; that changes in 7b and
// this predicate should be revisited then.
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
