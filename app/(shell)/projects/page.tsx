import { ProjectsScreen } from '@/components/projects/ProjectsScreen';

/**
 * `/projects` -- thin wrapper. Data loading moved into the self-contained
 * `ProjectsManager` (nav IA restructure) so the same manager can also mount in
 * the Settings "Projects" tab. This route is no longer in the sidebar but stays
 * reachable so `/projects/[id]`'s back-link keeps resolving.
 */
export default function ProjectsPage() {
  return <ProjectsScreen />;
}
