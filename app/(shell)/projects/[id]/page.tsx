'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ProjectDetailScreen } from '@/components/projects/ProjectDetailScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/projects/[id]` -- the per-project detail screen, inside the sidebar
 * shell. Loads reports/dailies/projects itself and resolves `id` via
 * `useParams()`, same "small enough to skip a route-level orchestrator"
 * reasoning as `app/(shell)/reports/[id]/page.tsx`. An unknown id redirects
 * to `/projects`, matching that route's (and `WizardPage`'s) unknown-id
 * precedent.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports: weeklies, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();
  const { projects, renameProject, deleteProject, loadError: projectsError } = useProjects();

  const loadError = weekliesError ?? dailiesError ?? projectsError;

  const id = params.id;
  const project = projects?.find((p) => p.id === id) ?? null;
  const notFound = projects !== null && project === null;

  useEffect(() => {
    if (notFound) router.replace('/projects');
  }, [notFound, router]);

  if (loadError) return <LoadErrorState title="Project" message={loadError} />;

  if (weeklies === null || dailies === null || projects === null || notFound || !project) return null;

  return (
    <ProjectDetailScreen
      project={project}
      weeklies={weeklies}
      dailies={dailies}
      onRename={(name) => renameProject(id, name)}
      onDelete={() => deleteProject(id)}
    />
  );
}
