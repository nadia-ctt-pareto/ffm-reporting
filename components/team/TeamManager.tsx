'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { useSession } from '@/lib/hooks/useSession';
import { useTeamMembers } from '@/lib/hooks/useTeamMembers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { resolveNewTeamMemberName } from '@/lib/team';
import type { TeamMember, TeamMemberRole } from '@/lib/types';
import styles from './TeamManager.module.css';

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

const ROLE_OPTIONS: { value: TeamMemberRole; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'pm', label: 'PM' },
  { value: 'admin', label: 'Admin' },
];

function roleLabel(role: TeamMemberRole): string {
  return ROLE_OPTIONS.find((opt) => opt.value === role)?.label ?? role;
}

/**
 * Settings -> Team tab (WP1). Clones `ProjectsManager.tsx`'s self-contained-
 * manager shape (owns its own data via `useTeamMembers()`, no route-level
 * orchestrator -- `app/(shell)/settings/page.tsx` stays a thin wrapper) but
 * INLINES rename/delete into this same table, unlike Projects (which pushes
 * those onto a separate `/projects/[id]` detail route): a team directory row
 * has no natural detail page of its own to host them on, so the "disabled
 * with a hint, never hidden" admin-gated controls (CLAUDE.md's Phase 8c
 * posture, cloned from `ProjectDetailScreen.tsx`) live directly in each row
 * here instead.
 *
 * **Admin gating covers Create too, unlike Projects.** `team_members_insert`
 * RLS (supabase/migrations/20260726000016_team_members.sql) is admin-only --
 * unlike `projects_insert` (any authenticated user may create a project) --
 * because creating a directory row is itself a privileged act here (see
 * that migration's header comment). So "New Member" is disabled-with-a-hint
 * for a non-admin too, not just Rename/Delete. Demo mode (no Supabase
 * configured) has no session/admin concept at all -- `isAdmin` is
 * unconditionally `true` there, mirroring `ProjectDetailScreen`'s identical
 * demo-mode posture verbatim.
 *
 * **Role/email are only set at creation.** There is no "edit an existing
 * member's role/email" control here -- `renameTeamMember` (the only mutating
 * function besides create/delete this package ships) touches EXACTLY the
 * `name` field, mirroring `renameProject`'s identical narrow contract (see
 * `lib/server/reports-service.ts`'s `renameTeamMember` doc comment). This is
 * a deliberate, locked scope boundary for this package, not an oversight --
 * changing someone's role/email after the fact is a reasonable follow-up for
 * a later package, once there's a real assignee feature that would make that
 * urgent.
 */
export function TeamManager() {
  const { user } = useSession();
  const configured = isSupabaseConfigured();
  const isAdmin = !configured || user?.app_metadata?.role === 'admin';

  const { members, loadError, mutationError, upsertTeamMember, renameTeamMember, deleteTeamMember } = useTeamMembers();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<TeamMemberRole>('member');
  const [email, setEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<TeamMember | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Validated live so the dialog error updates as the user types (same
  // pattern as ProjectsManager's `resolution`/CsvImportSection's
  // `newProjectResolution`).
  const resolution = createOpen ? resolveNewTeamMemberName(name, members ?? []) : null;

  function openRename(member: TeamMember) {
    setRenameTarget(member);
    setRenameValue(member.name);
    setRenameError(null);
  }

  function openDelete(member: TeamMember) {
    setDeleteTarget(member);
    setDeleteError(null);
  }

  // Computed unconditionally (before the loading early-return) to keep hook
  // order stable -- coalesces the still-loading null to an empty array so
  // it's a safe no-op then, same convention as ProjectsManager's `rows`.
  const rows = useMemo(() => {
    if (!members) return [];
    return [...members]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => ({
        name: member.name,
        role: <Badge tone="sage">{roleLabel(member.role)}</Badge>,
        email: member.email ?? <span className={styles.mutedCell}>—</span>,
        actions: (
          <div className={styles.rowActions}>
            <Button variant="outline" size="sm" onClick={() => openRename(member)} disabled={!isAdmin}>
              Rename
            </Button>
            <Button variant="danger" size="sm" icon={<IconTrash />} onClick={() => openDelete(member)} disabled={!isAdmin}>
              Delete
            </Button>
          </div>
        ),
      }));
  }, [members, isAdmin]);

  if (loadError) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    );
  }

  // Still loading: render nothing rather than a flash of an empty table (same rationale as ProjectsManager's null-guard).
  if (members === null) return null;

  function openCreate() {
    setName('');
    setRole('member');
    setEmail('');
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!resolution || resolution.error || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const trimmedEmail = email.trim();
      await upsertTeamMember({ id: resolution.id, name: resolution.name, role, email: trimmedEmail || null });
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create the team member.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRename() {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || isRenaming) return;
    setIsRenaming(true);
    setRenameError(null);
    try {
      await renameTeamMember(renameTarget.id, trimmed);
      setRenameTarget(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename the team member.');
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteTeamMember(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the team member.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div>
      <p className={styles.mutedNote}>
        Role here is a directory label. Permissions come from the account&apos;s role, which an admin sets outside the app.
      </p>

      {mutationError ? (
        <p className={styles.error} role="alert">
          {mutationError}
        </p>
      ) : null}

      <div className={styles.managerBar}>
        <Button variant="primary" size="md" onClick={openCreate} disabled={!isAdmin}>
          New Member
        </Button>
      </div>
      {!isAdmin ? <div className={styles.adminHint}>Adding, renaming, and removing team members are admin-only.</div> : null}

      {members.length === 0 ? <div className={styles.emptyState}>No team members yet.</div> : <Table columns={COLUMNS} rows={rows} stacked />}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Team Member" width={440}>
        <div>
          <Input label="Name" placeholder="e.g. Jamie Rivera" value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus />
          <div className={styles.fieldSpacer}>
            <Select label="Role" options={ROLE_OPTIONS} value={role} onChange={(v) => setRole(v as TeamMemberRole)} />
          </div>
          <div className={styles.fieldSpacer}>
            <Input
              label="Email (optional)"
              placeholder="jamie@foundationfirst.com"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />
          </div>
          <p className={styles.dialogNote}>
            Setting an email lets this person link their own account automatically the next time they sign in with a
            matching, verified email -- it does not grant access by itself.
          </p>
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
              {isCreating ? 'Creating…' : 'Create Member'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={renameTarget !== null} onClose={() => setRenameTarget(null)} title="Rename Team Member" width={440}>
        <div>
          <Input label="Name" value={renameValue} onChange={(e: ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)} autoFocus />
          <p className={styles.dialogNote}>This only changes the display name -- role, email, and any linked account are untouched.</p>
          {renameError ? (
            <p className={styles.fieldError} role="alert">
              {renameError}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleRename} disabled={!renameValue.trim() || isRenaming}>
              {isRenaming ? 'Renaming…' : 'Save'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete Team Member" width={440}>
        <div>
          <p className={styles.dialogNote}>
            Delete &ldquo;{deleteTarget?.name}&rdquo; from the directory? This does not affect their account or sign-in --
            it only removes this directory row.
          </p>
          {deleteError ? (
            <p className={styles.fieldError} role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="dangerSolid" size="sm" icon={<IconTrash />} onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete Member'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
