import { Suspense } from 'react';
import { MyWeekPresentScreen } from '@/components/my-week/MyWeekPresentScreen';

/**
 * `/my-week/present` -- WP6's print route. Deliberately lives OUTSIDE the
 * `(shell)` route group (compare `app/(shell)/my-week/page.tsx`), mirroring
 * `app/reports/[id]/present/page.tsx` -- only the root layout (fonts,
 * ThemeProvider) wraps it, no sidebar.
 *
 * Unlike the tokened `/reports/[id]/present` route, this one carries no
 * share token and is NOT in `middleware.ts`'s public-path allowlist -- an
 * unauthenticated visit redirects to `/login?next=/my-week/present...`, the
 * same as any `(shell)` route. That's deliberate: this digest is built from
 * the VIEWER'S OWN session (`useReports()`/`useDailyReports()`/
 * `useAssignedTasks()`/`useSession()`, all read inside `MyWeekPresentScreen`
 * itself), never from a public per-report token, so there is no "anonymous
 * recipient" audience for this route the way there is for a shared report.
 *
 * `<Suspense>` is required: `MyWeekPresentScreen` reads `useSearchParams()`
 * (for `weekStart`/`scope`/`date`/`print`), and Next.js requires that hook's
 * nearest client component to sit under a Suspense boundary, or `next build`
 * fails prerendering this route.
 */
export default function MyWeekPresentPage() {
  return (
    <Suspense fallback={null}>
      <MyWeekPresentScreen />
    </Suspense>
  );
}
