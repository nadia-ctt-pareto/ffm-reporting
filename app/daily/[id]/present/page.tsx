import { Suspense } from 'react';
import { PresentScreen } from '@/components/report/PresentScreen';

/**
 * `/daily/[id]/present` -- the daily-report sibling of
 * `app/reports/[id]/present/page.tsx`. Deliberately lives OUTSIDE the
 * `(shell)` route group so only the root layout (fonts, ThemeProvider)
 * applies -- no sidebar on the bare, shareable slide-deck route.
 *
 * `<Suspense>` is required here for the same reason as the weekly present
 * route: `PresentScreen` reads `useSearchParams()` (for `?print=1`).
 */
export default async function PresentDailyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PresentScreen id={id} kind="daily" />
    </Suspense>
  );
}
