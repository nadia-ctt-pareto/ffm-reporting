'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import { projectRollup } from '@/lib/project-view';
import { resolveNewProjectName } from '@/lib/projects';
import styles from './ProjectsManager.module.css';

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'reports', label: 'Reports', align: 'center' },
  { key: 'openTasks', label: 'Open Tasks', align: 'center' },
  { key: 'blocked', label: 'Blocked', align: 'center' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * Nav IA restructure: the project list + "New Project" create dialog, extracted
 * from the old `ProjectsScreen` into a **self-contained** manager so it can mount
 * in two places -- the `/projects` route (wrapped by `ProjectsScreen` with a
 * PageHeader) AND the Settings "Projects" tab -- without a route-level orchestrator
 * threading props. It owns its own data (mirrors `CsvImportSection`'s
 * self-contained convention). Rename/delete stay on the per-project detail screen
 * (`/projects/[id]`, admin-gated) -- creating a project is all-authenticated, so
 * this needs no admin gating of its own. No PageHeader/title here: its container
 * supplies the heading (the route's PageHeader or the Settings tab label).
 */
export function ProjectsManager() {
  const { reports: weeklies, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();
  const { projects, upsertProject, loadError: projectsError } = useProjects();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Validated live so the dialog error updates as the user types (same pattern
  // as CsvImportSection's `newProjectResolution`).
  const resolution = createOpen ? resolveNewProjectName(name, projects ?? []) : null;

  // Computed unconditionally (before the loading early-return) to keep hook order
  // stable; coalesces the still-loading nulls to empty so it's a safe no-op then.
  const rows = useMemo(() => {
    if (!projects || !weeklies || !dailies) return [];
    return [...projects]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) => {
        const rollup = projectRollup(project, weeklies, dailies);
        return {
          name: project.name,
          reports: String(rollup.reports.length),
          openTasks: String(rollup.openTasks.length),
          blocked: String(rollup.blockedTasks.length),
          actions: (
            <Link href={`/projects/${project.id}`} className={styles.rowAction}>
              View
            </Link>
          ),
        };
      });
  }, [projects, weeklies, dailies]);

  const loadError = weekliesError ?? dailiesError ?? projectsError;
  if (loadError) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    );
  }

  // Still loading: render nothing rather than a flash of an empty table (same
  // rationale as the report-list orchestrators' null-guard).
  if (weeklies === null || dailies === null || projects === null) return null;

  function openCreate() {
    setName('');
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!resolution || resolution.error || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await upsertProject({ id: resolution.id, name: resolution.name });
      setCreateOpen(false);
      setName('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create the project.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div>
      <div className={styles.managerBar}>
        <Button variant="primary" size="md" onClick={openCreate}>
          New Project
        </Button>
      </div>

      {projects.length === 0 ? <div className={styles.emptyState}>No projects yet.</div> : <Table columns={COLUMNS} rows={rows} stacked />}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Project" width={440}>
        <div>
          <Input
            label="Project Name"
            placeholder="e.g. Riverside Property Group"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            autoFocus
          />
          {resolution?.error ? <p className={styles.fieldError}>{resolution.error}</p> : null}
          {createError ? (
            <p className={styles.fieldError} role="alert">
              {createError}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreate} disabled={!resolution || Boolean(resolution.error) || isCreating}>
              {isCreating ? 'Creating…' : 'Create Project'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
