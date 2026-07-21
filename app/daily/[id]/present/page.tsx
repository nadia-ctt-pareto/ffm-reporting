import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PresentScreen } from '@/components/report/PresentScreen';
import { getSharedReport } from '@/lib/server/reports-service';
import { getSupabaseAnonClient } from '@/lib/supabase/anon';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { AnyReport } from '@/lib/types';

// Phase 7b (M3): see app/reports/[id]/present/page.tsx's identical `metadata`
// export for the full rationale (Referer leakage of `?t=`).
export const metadata: Metadata = {
  referrer: 'no-referrer',
};

/** Daily sibling of app/reports/[id]/present/page.tsx's `resolveShared` -- see that function's doc comment for the full rationale. Only difference: requires `kind === 'daily'`. */
async function resolveShared(id: string, token: string | undefined): Promise<AnyReport | null | undefined> {
  if (!isSupabaseConfigured() || !token) return undefined;
  try {
    const client = getSupabaseAnonClient();
    const report = await getSharedReport(client, token);
    if (!report || report.id !== id || report.kind !== 'daily') return null;
    return report;
  } catch (err) {
    console.error('[daily/[id]/present] failed to resolve share token', err);
    return null;
  }
}

/**
 * `/daily/[id]/present` -- the daily-report sibling of
 * `app/reports/[id]/present/page.tsx`. Deliberately lives OUTSIDE the
 * `(shell)` route group so only the root layout (fonts, ThemeProvider)
 * applies -- no sidebar on the bare, shareable slide-deck route.
 *
 * `<Suspense>` is required here for the same reason as the weekly present
 * route: `PresentScreen` reads `useSearchParams()` (for `?print=1`).
 *
 * Phase 7b (M3): resolves `?t=` server-side exactly like the weekly present
 * route -- see that file's doc comments (trap #2's structural guarantee is
 * identical here, just gated on `kind === 'daily'` instead of `'weekly'`).
 */
export default async function PresentDailyReportPage({
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
      <PresentScreen id={id} kind="daily" shared={shared} />
    </Suspense>
  );
}
