import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PresentScreen } from '@/components/report/PresentScreen';
import { getSharedReport } from '@/lib/server/reports-service';
import { getSupabaseAnonClient } from '@/lib/supabase/anon';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { AnyReport } from '@/lib/types';

// Phase 7b (M3): `no-referrer` -- once this route reads `?t=`, the token
// would otherwise leak via the `Referer` header on any outbound click from
// this page (and into any server access log that captures it), even though
// the token is never rendered into a visible link. Applies to every request
// to this route, tokened or not -- there's no reason to ever send a Referer
// from a page whose whole job is being a bare, shareable artifact.
export const metadata: Metadata = {
  referrer: 'no-referrer',
};

/**
 * Resolves `?t=<token>` server-side, BEFORE `PresentScreen` ever renders --
 * see CLAUDE.md's "carried trap #2." Returns:
 *   - `undefined` when there's no token to resolve (not configured, or `t`
 *     absent) -- `PresentScreen` falls back to its existing session/hooks
 *     path, unchanged.
 *   - `null` when a token WAS present but didn't resolve to a real,
 *     matching, still-shared report -- `PresentScreen` renders its
 *     not-found state and the session/hooks path is never consulted, even
 *     for a signed-in visitor (this is what makes the token the ONLY key:
 *     see `getSupabaseAnonClient`'s doc comment -- the client used here has
 *     no cookies to fall back to in the first place).
 *   - a real `AnyReport` only when the token resolved to a report whose
 *     `id` AND `kind` both match this exact route.
 *
 * Any unexpected failure (a genuine Supabase outage, an RPC error) is
 * treated as "not found" too, never re-thrown into a page crash and never
 * silently falling through to the session path -- fails closed, logs
 * server-side.
 */
async function resolveShared(id: string, token: string | undefined): Promise<AnyReport | null | undefined> {
  if (!isSupabaseConfigured() || !token) return undefined;
  try {
    const client = getSupabaseAnonClient();
    const report = await getSharedReport(client, token);
    if (!report || report.id !== id || report.kind !== 'weekly') return null;
    return report;
  } catch (err) {
    console.error('[reports/[id]/present] failed to resolve share token', err);
    return null;
  }
}

/**
 * `/reports/[id]/present` -- deliberately lives OUTSIDE the `(shell)` route
 * group (compare `app/(shell)/reports/[id]/page.tsx`) so only the root
 * layout (app/layout.tsx: fonts, ThemeProvider) wraps it -- the sidebar
 * shell never applies here. This is a distinct resolved path from every
 * `(shell)` route, so there's no route-group collision.
 *
 * `<Suspense>` is required here: PresentScreen reads `useSearchParams()`
 * (for `?print=1`), and Next.js requires that hook's nearest client
 * component to sit under a Suspense boundary, or `next build` fails
 * prerendering this route.
 *
 * Phase 7b (M3): also awaits `searchParams` (a plain object here, not the
 * `URLSearchParams`-flavored hook `PresentScreen` itself uses for `?slide=`/
 * `?print=1`) to resolve `?t=` server-side via `resolveShared` above, and
 * passes the result down as `shared`.
 */
export default async function PresentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const token = typeof t === 'string' ? t : undefined;
  const shared = await resolveShared(id, token);
  return (
    <Suspense fallback={null}>
      <PresentScreen id={id} shared={shared} />
    </Suspense>
  );
}
