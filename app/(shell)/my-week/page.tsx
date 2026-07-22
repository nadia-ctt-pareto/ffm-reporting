'use client';

import { Suspense } from 'react';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { MyWeekScreen } from '@/components/my-week/MyWeekScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/my-week` -- thin route wrapper (mirrors `app/(shell)/calendar/page.tsx`):
 * owns both `useReports()`/`useDailyReports()` calls and renders nothing
 * until both lists resolve, so there is no localStorage-during-SSR /
 * hydration mismatch. All week/day/scope state lives in `MyWeekScreen`.
 * `<Suspense>` is required because `MyWeekScreen` reads `useSearchParams()`
 * for `?date=` (the day drill-down's linkable state) -- the same
 * requirement `app/(shell)/settings/page.tsx`/`app/(shell)/tasks/page.tsx`
 * already document for their own `?tab=`/`?view=` params.
 */
function MyWeekPageInner() {
  const { reports, loadError: reportsError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();

  if (reports === null || dailies === null) {
    const err = reportsError ?? dailiesError;
    if (err) return <LoadErrorState title="My Week" message={err} />;
    return null;
  }

  return <MyWeekScreen weeklies={reports} dailies={dailies} />;
}

export default function MyWeekPage() {
  return (
    <Suspense>
      <MyWeekPageInner />
    </Suspense>
  );
}
