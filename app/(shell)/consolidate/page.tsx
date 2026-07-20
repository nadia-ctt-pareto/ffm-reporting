'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
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
  const { reports: weeklies, upsertReport, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();
  const { projects, loadError: projectsError } = useProjects();

  // Post-review hardening round 2 (SHOULD-FIX H): a COMPOUND guard across
  // three independent hooks -- any one of them can fail its initial load
  // while the other two succeed, so all three `loadError`s must be checked
  // (not just one), unlike every other single-hook route wrapper.
  const loadError = weekliesError ?? dailiesError ?? projectsError;
  if (loadError) return <LoadErrorState title="Consolidate" message={loadError} />;

  if (weeklies === null || dailies === null || projects === null) return null;

  return <ConsolidateScreen weeklies={weeklies} dailies={dailies} projects={projects} onCreateReport={upsertReport} />;
}
