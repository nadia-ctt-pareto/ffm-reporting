'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { useSession } from '@/lib/hooks/useSession';
import { projectIsReferenced, projectRollup } from '@/lib/project-view';
import { fmtDateShort } from '@/lib/format';
import { reportPeriodLabel, riskTone, taskTone } from '@/lib/report-utils';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { DailyReport, Project, Report } from '@/lib/types';
import styles from './ProjectDetailScreen.module.css';

export interface ProjectDetailScreenProps {
  project: Project;
  weeklies: Report[];
  dailies: DailyReport[];
  /** Renames EXACTLY `project`'s `name` -- matches `useProjects().renameProject`. See CLAUDE.md's "THE CRUX -- rename safety". */
  onRename: (name: string) => Promise<void>;
  /** Deletes `project` -- matches `useProjects().deleteProject`; rejects (curated "still referenced") if the DB FK blocks it. */
  onDelete: () => Promise<void>;
}

const REPORT_COLUMNS: TableColumn[] = [
  { key: 'period', label: 'Period' },
  { key: 'kind', label: 'Kind' },
  { key: 'status', label: 'Status' },
  { key: 'tasks', label: 'Tasks', align: 'center' },
  { key: 'risks', label: 'Risks', align: 'center' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

const TASK_COLUMNS: TableColumn[] = [
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'actions', label: '', align: 'right', isAction: true, stackedLabel: 'Report' },
];

/**
 * `/projects/[id]` -- name heading, admin-gated Rename/Delete, a StatCard
 * row, the associated reports table (weeklies + dailies, `projectRollup`),
 * and open tasks / risks lists. Owns its own small Rename/Delete-dialog
 * state directly -- no separate route-level orchestrator, same pattern as
 * `ReportScreen`'s Share-dialog state.
 *
 * **Admin gating (UI only -- the server/RLS is the real control, see
 * CLAUDE.md's "LOCKED DECISION: rename/delete = ADMINS ONLY")**: in
 * Supabase mode, `useSession()`'s `user.app_metadata?.role === 'admin'` --
 * exactly what `public.is_admin()` reads server-side -- decides whether the
 * Rename/Delete buttons are enabled; a non-admin sees them disabled with an
 * "Admins only" hint rather than hidden outright, so the feature's
 * existence isn't a mystery. **In demo mode** (no Supabase configured)
 * there is no session/auth concept at all -- this app's data is
 * per-browser `localStorage`, so treating every user as fully privileged
 * over their own local data is the sensible default (documented choice,
 * not an oversight): `isAdmin` is unconditionally `true` when
 * `!isSupabaseConfigured()`.
 */
export function ProjectDetailScreen({ project, weeklies, dailies, onRename, onDelete }: ProjectDetailScreenProps) {
  const { user } = useSession();
  const configured = isSupabaseConfigured();
  const isAdmin = !configured || user?.app_metadata?.role === 'admin';

  const rollup = useMemo(() => projectRollup(project, weeklies, dailies), [project, weeklies, dailies]);
  const referenced = useMemo(() => projectIsReferenced(project, weeklies, dailies), [project, weeklies, dailies]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openRename() {
    setRenameValue(project.name);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function handleRename() {
    const name = renameValue.trim();
    if (!name || isRenaming) return;
    setIsRenaming(true);
    setRenameError(null);
    try {
      await onRename(name);
      setRenameOpen(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename the project.');
    } finally {
      setIsRenaming(false);
    }
  }

  function openDelete() {
    setDeleteError(null);
    setDeleteOpen(true);
  }

  /**
   * Post-review SHOULD-FIX 2: no `router.push` here anymore. `onDelete`
   * (`useProjects().deleteProject`) is now non-optimistic -- it only removes
   * `project.id` from `projects` state AFTER the repository call actually
   * succeeds, and that state change is what flips the route wrapper's
   * (`app/(shell)/projects/[id]/page.tsx`) `notFound`, whose own effect
   * already redirects to `/projects`. A `router.push` here too would have
   * double-navigated on success. Just close the dialog on success -- the
   * screen unmounts a beat later via that redirect. On failure, `projects`
   * state never changed, so the screen stays mounted and `deleteError`
   * below is actually visible (the bug this fixed: an OPTIMISTIC removal
   * used to fire the redirect immediately, unmounting this screen before a
   * later rejection could ever render here).
   */
  async function handleDelete() {
    if (referenced || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the project.');
      setIsDeleting(false);
    }
  }

  const reportRows = rollup.reports.map((r) => ({
    period: reportPeriodLabel(r),
    kind: r.kind === 'weekly' ? 'Weekly' : 'Daily',
    status: <Badge tone="sage">{r.status}</Badge>,
    tasks: String(r.tasks.length),
    risks: String(r.risks.length),
    actions: (
      <Link href={r.kind === 'weekly' ? `/reports/${r.id}` : `/daily/${r.id}`} className={styles.rowAction}>
        View
      </Link>
    ),
  }));

  const taskRows = rollup.openTasks.map(({ report, task }) => ({
    task: task.task,
    status: <Badge tone={taskTone(task.status)}>{task.status}</Badge>,
    deadline: fmtDateShort(task.deadline),
    actions: (
      <Link href={report.kind === 'weekly' ? `/reports/${report.id}` : `/daily/${report.id}`} className={styles.rowAction}>
        {reportPeriodLabel(report)}
      </Link>
    ),
  }));

  return (
    <div>
      <div className={styles.header}>
        <div>
          <Link href="/projects" className={styles.backLink}>
            &larr; Back to Projects
          </Link>
          <h1 className={styles.title}>{project.name}</h1>
        </div>
        <div className={styles.headerActions}>
          <Button variant="outline" size="sm" onClick={openRename} disabled={!isAdmin}>
            Rename
          </Button>
          <Button variant="outline" size="sm" onClick={openDelete} disabled={!isAdmin}>
            Delete
          </Button>
        </div>
      </div>
      {!isAdmin ? <div className={styles.adminHint}>Renaming and deleting projects are admin-only.</div> : null}

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <StatCard label="Associated Reports" value={String(rollup.reports.length)} />
          <StatCard label="Open Tasks" value={String(rollup.openTasks.length)} />
          <StatCard label="Blocked" value={String(rollup.blockedTasks.length)} />
          <StatCard label="Open Risks" value={String(rollup.risks.length)} />
        </div>

        <div className={styles.sectionKicker}>Associated Reports</div>
        {rollup.reports.length > 0 ? (
          <Table columns={REPORT_COLUMNS} rows={reportRows} dense stacked />
        ) : (
          <div className={styles.mutedNote}>No reports are associated with this project yet.</div>
        )}

        <div className={styles.sectionKicker} style={{ marginTop: 32 }}>
          Open Tasks
        </div>
        {rollup.openTasks.length > 0 ? (
          <Table columns={TASK_COLUMNS} rows={taskRows} dense stacked />
        ) : (
          <div className={styles.mutedNote}>No open tasks for this project.</div>
        )}

        <div className={styles.sectionKicker} style={{ marginTop: 32 }}>
          Risks
        </div>
        {rollup.risks.length > 0 ? (
          <div className={styles.riskList}>
            {rollup.risks.map(({ report, risk }) => (
              <div key={risk.id} className={styles.riskCard}>
                <div className={styles.riskHeading}>
                  <span>{risk.client}</span>
                  <Badge tone={riskTone(risk.severity)}>{risk.severity}</Badge>
                </div>
                <div className={styles.riskDescription}>{risk.description}</div>
                <div className={styles.riskFooter}>
                  <span className={styles.riskNextStep}>Next step: {risk.nextStep}</span>
                  <Link href={report.kind === 'weekly' ? `/reports/${report.id}` : `/daily/${report.id}`} className={styles.rowAction}>
                    {reportPeriodLabel(report)}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.mutedNote}>No open risks for this project.</div>
        )}
      </div>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename Project" width={440}>
        <div>
          <Input
            label="Project Name"
            value={renameValue}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)}
            autoFocus
          />
          <p className={styles.dialogNote}>
            This only changes the project&apos;s display name. Existing tasks/risks keep their original client text and stay
            linked to this project.
          </p>
          {renameError ? (
            <p className={styles.fieldError} role="alert">
              {renameError}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button variant="ghost" size="sm" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleRename} disabled={!renameValue.trim() || isRenaming}>
              {isRenaming ? 'Renaming…' : 'Save'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Project" width={440}>
        <div>
          {referenced ? (
            <p className={styles.dialogNote}>
              &ldquo;{project.name}&rdquo; is still referenced by existing reports, tasks, or risks and can&apos;t be
              deleted. Nothing was linked to it? Check that any imported reports for this project have been removed first.
            </p>
          ) : (
            <p className={styles.dialogNote}>
              Delete &ldquo;{project.name}&rdquo;? This cannot be undone. Any reports that mention this client by name
              only (not linked by id) keep their text as-is and are unaffected.
            </p>
          )}
          {deleteError ? (
            <p className={styles.fieldError} role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={referenced || isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete Project'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
