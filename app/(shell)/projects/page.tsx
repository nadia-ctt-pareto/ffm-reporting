'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ProjectsScreen } from '@/components/projects/ProjectsScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/projects` -- thin route wrapper (mirrors `app/(shell)/consolidate/page.tsx`):
 * owns `useReports()`/`useDailyReports()`/`useProjects()` and renders nothing
 * until all three have resolved, so there is no localStorage-during-SSR and
 * no hydration mismatch. All list/create-dialog state lives in
 * `ProjectsScreen` -- no filters/pagination/dialog hosting here beyond what
 * that screen owns itself, so (per the tasks/calendar/settings/consolidate
 * no-orchestrator precedent) there's no separate route-level orchestrator
 * either.
 */
export default function ProjectsPage() {
  const { reports: weeklies, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();
  const { projects, upsertProject, loadError: projectsError } = useProjects();

  // Post-review hardening round 2 (SHOULD-FIX H)-style compound guard: see
  // ConsolidatePage's identical rationale -- any one of the three hooks can
  // fail its initial load while the other two succeed.
  const loadError = weekliesError ?? dailiesError ?? projectsError;
  if (loadError) return <LoadErrorState title="Projects" message={loadError} />;

  if (weeklies === null || dailies === null || projects === null) return null;

  return <ProjectsScreen projects={projects} weeklies={weeklies} dailies={dailies} onCreateProject={upsertProject} />;
}
