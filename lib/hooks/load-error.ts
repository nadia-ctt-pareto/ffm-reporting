// Post-review hardening (SHOULD-FIX 11): shared by useReports.ts,
// useDailyReports.ts, and useProjects.ts's initial-load `.catch()`. Two
// problems, one fix:
//
//   1. `loadError` was set but never READ anywhere under components/ or
//      app/ -- a failed initial `getAll()`/`getAllDaily()`/`getProjects()`
//      left every shell screen's `if (reports === null) return null;` guard
//      permanently true, so the user saw sidebar-plus-blank-white-content
//      forever, with no error, no retry, no explanation. `DashboardPage`/
//      `DailyPage` now render `loadError` via `LoadErrorState`
//      (components/app/LoadErrorState.tsx) instead of returning null.
//   2. A stale tab that outlives its Supabase session sees this specific
//      failure shape: the client-side route change fires a `fetch`, which
//      middleware answers with 401 JSON (not a document-navigation redirect
//      -- middleware only 307s document navigations to `/login`, see
//      middleware.ts). `errorMessage(err, ...)` alone would render "You
//      must be signed in to do that." next to a dead dashboard forever --
//      technically correct, but a straight redirect to `/login` is the
//      actually-useful response `HttpRepositoryError.status` was exposed
//      for. Demo mode (no `HttpReportsRepository` in play at all) can never
//      hit this branch -- `LocalStorageReportsRepository` never throws
//      `HttpRepositoryError`.
import { HttpRepositoryError } from '../data/http-reports-repository';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Call from an initial-load `.catch()`. Returns the string to pass to
 * `setLoadError` -- or `null` if this call already triggered a `/login`
 * redirect (in which case the caller should skip `setLoadError` entirely;
 * the navigation is about to unmount this component anyway).
 */
export function resolveLoadError(err: unknown, fallback: string): string | null {
  if (err instanceof HttpRepositoryError && err.status === 401 && typeof window !== 'undefined') {
    // NIT fix (post-review round 2): `pathname` alone dropped `search`/
    // `hash` -- a user 401'd out of a deep-linked filtered view (e.g.
    // `/tasks?status=Blocked`) landed back on the bare path after signing
    // back in, losing that filter state for no reason.
    const { pathname, search, hash } = window.location;
    window.location.assign(`/login?next=${encodeURIComponent(pathname + search + hash)}`);
    return null;
  }
  return errorMessage(err, fallback);
}
