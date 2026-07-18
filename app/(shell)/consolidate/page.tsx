'use client';

import { ConsolidateScreen } from '@/components/consolidate/ConsolidateScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/consolidate` -- thin route wrapper (mirrors `app/(shell)/tasks/page.tsx`
 * and `app/(shell)/calendar/page.tsx`): owns `useReports()`/
 * `useDailyReports()`/`useProjects()` and renders nothing until all three
 * have resolved, so there is no localStorage-during-SSR and no hydration
 * mismatch (see those hooks). All consolidation state/logic (the week
 * anchor, source include-checkboxes, rename acceptance, the live merge
 * preview) lives in `ConsolidateScreen` -- no filters/pagination/dialog
 * hosting here, so (per the tasks/calendar/settings no-orchestrator
 * precedent) there's no separate route-level orchestrator either.
 */
export default function ConsolidatePage() {
  const { reports: weeklies, upsertReport } = useReports();
  const { reports: dailies } = useDailyReports();
  const { projects } = useProjects();

  if (weeklies === null || dailies === null || projects === null) return null;

  return <ConsolidateScreen weeklies={weeklies} dailies={dailies} projects={projects} onCreateReport={upsertReport} />;
}
