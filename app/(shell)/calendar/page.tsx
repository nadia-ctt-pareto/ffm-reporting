'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
import { CalendarScreen } from '@/components/calendar/CalendarScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/calendar` -- thin route wrapper (mirrors `app/(shell)/page.tsx` and
 * `app/(shell)/tasks/page.tsx`): owns `useReports()` and renders nothing
 * until `reports !== null`, so there is no localStorage-during-SSR and no
 * hydration mismatch (see `useReports`). All Calendar-view state/logic
 * lives in `CalendarScreen`.
 *
 * WP5 (calendar task lens): also loads `useDailyReports()` now -- report
 * bars stay weekly-only (`reports` alone, unchanged), but the new task-chip
 * layer needs dailies too (see `CalendarScreen`'s own `dailies` prop doc
 * comment for why). Gated on BOTH lists resolving, same pattern
 * `HomePage.tsx` already established for the same two-hook combination.
 */
export default function CalendarPage() {
  const { reports, loadError: reportsError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (reports === null || dailies === null) {
    const err = reportsError ?? dailiesError;
    if (err) return <LoadErrorState title="Calendar" message={err} />;
    return null;
  }

  return <CalendarScreen reports={reports} dailies={dailies} />;
}
