'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
import { CalendarScreen } from '@/components/calendar/CalendarScreen';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/calendar` -- thin route wrapper (mirrors `app/(shell)/page.tsx` and
 * `app/(shell)/tasks/page.tsx`): owns `useReports()` and renders nothing
 * until `reports !== null`, so there is no localStorage-during-SSR and no
 * hydration mismatch (see `useReports`). All Calendar-view state/logic
 * lives in `CalendarScreen`.
 */
export default function CalendarPage() {
  const { reports, loadError } = useReports();

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (reports === null) {
    if (loadError) return <LoadErrorState title="Calendar" message={loadError} />;
    return null;
  }

  return <CalendarScreen reports={reports} />;
}
