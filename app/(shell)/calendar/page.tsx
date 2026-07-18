'use client';

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
  const { reports } = useReports();

  if (reports === null) return null;

  return <CalendarScreen reports={reports} />;
}
