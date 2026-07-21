'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { projectRollup } from '@/lib/project-view';
import { resolveNewProjectName } from '@/lib/projects';
import type { DailyReport, Project, Report } from '@/lib/types';
import styles from './ProjectsScreen.module.css';

export interface ProjectsScreenProps {
  projects: Project[];
  weeklies: Report[];
  dailies: DailyReport[];
  /**
   * Persists a newly-created project -- matches `useProjects().upsertProject`'s
   * shape exactly (insert-or-return-existing on the server/Supabase side;
   * this screen's own create dialog pre-validates via `resolveNewProjectName`
   * BEFORE calling this, so a genuine id/name collision is caught with a
   * visible message rather than silently reaching that insert-or-return-
   * existing behavior -- see `lib/projects.ts`'s doc comment).
   */
  onCreateProject: (project: Project) => Promise<void>;
}

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'reports', label: 'Reports', align: 'center' },
  { key: 'openTasks', label: 'Open Tasks', align: 'center' },
  { key: 'blocked', label: 'Blocked', align: 'center' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * `/projects` -- list every project with per-project stats (`projectRollup`,
 * `lib/project-view.ts`) plus a "New Project" create dialog. Rename/delete
 * are deliberately NOT here -- both are admin-gated actions that live on the
 * per-project detail screen (`ProjectDetailScreen.tsx`) instead; creating a
 * project is all-authenticated (same as the CSV importer's "New project…"
 * picker, `CsvImportSection.tsx`), so this screen needs no admin gating of
 * its own. No-orchestrator route (like `TaskViewScreen`/`CalendarScreen`/
 * `ConsolidateScreen`): this screen owns its own small create-dialog state
 * directly; `app/(shell)/projects/page.tsx` is a thin wrapper.
 */
export function ProjectsScreen({ projects, weeklies, dailies, onCreateProject }: ProjectsScreenProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Validated live (not just at submit time) so the dialog's own error
  // message updates as the user types -- same pattern as CsvImportSection's
  // `newProjectResolution`.
  const resolution = createOpen ? resolveNewProjectName(name, projects) : null;

  const rows = useMemo(
    () =>
      [...projects]
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
        }),
    [projects, weeklies, dailies]
  );

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
      await onCreateProject({ id: resolution.id, name: resolution.name });
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
      <PageHeader
        title="Projects"
        actions={
          <Button variant="primary" size="md" onClick={openCreate}>
            New Project
          </Button>
        }
      />

      <div className={styles.content}>
        {projects.length === 0 ? <div className={styles.emptyState}>No projects yet.</div> : <Table columns={COLUMNS} rows={rows} stacked />}
      </div>

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
