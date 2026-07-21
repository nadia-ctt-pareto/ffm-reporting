'use client';

import { PageHeader } from '@/components/app/PageHeader';
import { ProjectsManager } from '@/components/projects/ProjectsManager';
import styles from './ProjectsScreen.module.css';

/**
 * `/projects` -- the standalone project list route. Kept alive (though no longer
 * in the sidebar, nav IA restructure) so `/projects/[id]`'s back-link and the
 * detail route's not-found redirect still resolve. The list itself is the shared,
 * self-contained `ProjectsManager` (also mounted in the Settings "Projects" tab);
 * this route just gives it a page header.
 */
export function ProjectsScreen() {
  return (
    <div>
      <PageHeader title="Projects" />
      <div className={styles.content}>
        <ProjectsManager />
      </div>
    </div>
  );
}
