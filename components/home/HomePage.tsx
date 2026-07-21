'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
import { HomeScreen } from '@/components/home/HomeScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';

/**
 * Route-level orchestration for `/` (the Home overview). Loads both report
 * kinds (mirrors `DashboardPage`/`DailyPage`'s null-guard + `LoadErrorState`
 * pattern) and hands them to the presentational `HomeScreen`. Renders nothing
 * until BOTH lists resolve, so there is no localStorage-during-SSR / hydration
 * mismatch; a failed load on either surfaces an actionable error screen.
 */
export function HomePage() {
  const { reports: weeklies, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();

  if (weeklies === null || dailies === null) {
    const err = weekliesError ?? dailiesError;
    if (err) return <LoadErrorState title="Home" message={err} />;
    return null;
  }

  return <HomeScreen weeklies={weeklies} dailies={dailies} />;
}
