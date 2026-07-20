import { HttpReportsRepository } from './http-reports-repository';
import { LocalStorageReportsRepository } from './local-storage-reports-repository';
import type { ReportsRepository } from './reports-repository';
import { isSupabaseConfigured } from '../supabase/config';

export type { ReportsRepository } from './reports-repository';

let singleton: ReportsRepository | null = null;
let warnedFallback = false;

/**
 * Best-effort "does this look like a local/dev origin" check, used to
 * decide whether the one-time fallback warning below is worth printing, AND
 * (post-review, SHOULD-FIX 10) exported for `components/app/DemoModeBanner
 * .tsx`, which uses the identical predicate to decide whether to render its
 * in-app "Demo mode" notice. Never gates repository BEHAVIOR itself -- both
 * branches below still return `LocalStorageReportsRepository`; this only
 * controls how loudly the fallback is surfaced.
 */
export function isLocalDevOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');
}

/**
 * Single switch point for the repository implementation. UI code should
 * always go through this factory rather than importing a concrete
 * repository class.
 *
 * Phase 7b: `isSupabaseConfigured()` (NEXT_PUBLIC_SUPABASE_URL +
 * NEXT_PUBLIC_SUPABASE_ANON_KEY both set) decides `HttpReportsRepository`
 * vs. `LocalStorageReportsRepository` -- demo mode (neither set) keeps
 * being byte-for-byte Phase 1-6 on localStorage, unconditionally. This is a
 * deliberate tradeoff (see the Phase 7b plan's "Demo-mode decision"): a
 * misconfigured production deploy silently degrades into an
 * unauthenticated, per-browser localStorage app rather than failing loudly
 * -- mitigated by the one-time, non-localhost-only warning below (a real
 * production origin missing its env vars logs to the console; localhost/
 * `*.local` dev origins never do, since running without a configured
 * Supabase project is the normal, supported demo-mode workflow there).
 */
export function getReportsRepository(): ReportsRepository {
  if (!singleton) {
    if (isSupabaseConfigured()) {
      singleton = new HttpReportsRepository();
    } else {
      if (!warnedFallback && typeof window !== 'undefined' && !isLocalDevOrigin()) {
        warnedFallback = true;
        console.warn(
          '[getReportsRepository] NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are not set on a non-local origin -- falling back to per-browser localStorage persistence (no auth, no cross-device sharing, no server-side data for Phase 8\'s MCP server to read). Verify both env vars are configured before DNS cutover.'
        );
      }
      singleton = new LocalStorageReportsRepository();
    }
  }
  return singleton;
}
