'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDeleteReportDialog } from '@/components/dialogs/ConfirmDeleteReportDialog';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { STATUS_EDIT_OPTIONS } from '@/lib/constants';
import { fmtDateShort } from '@/lib/format';
import { groupTasksByClient, hasWin, SECTION_HEADINGS } from '@/lib/report-sections';
import { onSchedule, openBlockers, reportPeriodLabel, riskTone, taskTone } from '@/lib/report-utils';
import type { AnyReport, ReportFieldPatch, ReportKind, ReportStatus } from '@/lib/types';
import styles from './ReportScreen.module.css';

export interface ReportScreenProps {
  report: AnyReport | null;
  /** Which kind of report this screen mount is showing -- decides the editable period field(s) and every route it links out to, even while `report` is still null (see emptyReportFallback). */
  kind: ReportKind;
  onUpdateFields: (patch: ReportFieldPatch) => void;
  /**
   * An inline message shown under the period field(s) when the caller
   * rejected the last edit (blank, or -- daily only -- collides with
   * another daily) instead of persisting it. Daily: renders under the
   * single Date field -- see app/(shell)/daily/[id]/page.tsx and
   * invalidDailyDateEdit. Weekly (BLOCKER 2, Phase 7b): renders under the
   * Week Start/Week End pair -- clearing either field used to send
   * `{ weekStart: '' }`/`{ weekEnd: '' }` straight to `onUpdateFields`,
   * which `ReportPatchSchema`'s `isoDate.optional()` rejects with a raw
   * 400 in Supabase mode; see app/(shell)/reports/[id]/page.tsx.
   */
  periodError?: string;
  /** Phase 7b: `useReports()`/`useDailyReports()`'s `mutationError` -- when set, the autosave note below swaps from "Changes save automatically." to a visible failure message, mirroring the `periodError` prop pattern. */
  mutationError?: string | null;
  /**
   * WP4: deletes this report -- bound by the route wrapper
   * (app/(shell)/reports/[id]/page.tsx / daily/[id]/page.tsx) to
   * `useReports()`/`useDailyReports()`'s non-optimistic `deleteReport(id)`.
   * Optional so a hypothetical future non-route-backed `<ReportScreen>`
   * mount isn't forced to fabricate a no-op just to satisfy this prop; both
   * real call sites today always provide it. Rejects on failure (a curated
   * message server-side in Supabase mode, a plain `Error` in demo mode) --
   * see `handleDelete` below.
   */
  onDelete?: () => Promise<void>;
  /**
   * WP4: mirrors `ProjectDetailScreen`'s `isAdmin` gate -- decides whether
   * the Delete button is enabled. The route wrapper computes this
   * (owner-or-admin in Supabase mode via `useSession()`, matching
   * `reports_delete` RLS exactly; unconditionally `true` in demo mode) so
   * this component never needs to know about sessions/auth itself -- see
   * that wrapper's own doc comment. "Disable, don't hide" (the same Phase
   * 8c precedent `ProjectDetailScreen` set): a non-owner/non-admin still
   * sees the Delete button, disabled, with `deleteHint` explaining why,
   * rather than the control silently not existing for them.
   */
  canDelete: boolean;
  /** WP4: shown as the disabled Delete button's `title` (hover) and as a small inline note under the actions row when `!canDelete`. */
  deleteHint?: string;
}

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/**
 * WP2: columns for a daily report's per-client task tables -- deliberately
 * NO Client column, mirroring `ReportDeck.tsx`'s identical
 * `TASKS_BY_CLIENT_COLUMNS` (each file keeps its own copy of its column
 * list, same pre-existing convention as `TASK_COLUMNS` above, which was
 * already duplicated between this file and ReportDeck.tsx before this
 * change). The group's own client-name heading already carries what this
 * column would have repeated on every row.
 */
const TASKS_BY_CLIENT_COLUMNS: TableColumn[] = [
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/**
 * Faithful-port null-guard so this can render safely even while `report` is
 * briefly null (mirrors the old ReportDetailDialog's `dSafe`). Phase 4: a
 * function of `kind` (not a static constant) so the fallback's own
 * `kind`/period fields always match the route being viewed, even in that
 * split-second before `report` loads. Phase 5: no longer feeds a
 * `<ReportDeck>` here (the PDF-preview filmstrip was deleted -- the report
 * screen is now the working document; `/reports/[id]/present` is the
 * interactive slide deck / print artifact, see ReportDeck.tsx and
 * PresentScreen.tsx).
 */
function emptyReportFallback(kind: ReportKind): AnyReport {
  const core = {
    id: '',
    status: 'Draft' as const,
    preparedFor: '',
    preparedBy: '',
    createdAt: '',
    updatedAt: '',
    summaryNarrative: '',
    tasks: [],
    risks: [],
    win: { stat: '', label: '', narrative: '' },
    touchpoints: { calls: 0, emails: 0, escalations: 0, narrative: '' },
    priorities: [],
  };
  return kind === 'daily' ? { ...core, kind: 'daily', date: '' } : { ...core, kind: 'weekly', weekStart: '', weekEnd: '' };
}

/**
 * `/reports/[id]` (weekly) and `/daily/[id]` (Phase 4) -- the full report
 * screen, promoted from the old ReportDetailDialog (deleted, see CLAUDE.md).
 * Editable status/preparedFor/period autosave via `onUpdateFields`
 * (optimistic + fresh `updatedAt`, see useReports/useDailyReports);
 * everything else (stats, tasks, risks, priorities) stays read-only display,
 * same scope as the old Detail dialog.
 *
 * Phase 5: this IS the working document -- read + inline edit, native HTML,
 * scrollable. The PDF-preview filmstrip (a scaled-down `<ReportDeck>`) was
 * deleted; the present route (`/reports/[id]/present`) is now the shared
 * artifact -- an interactive slide deck AND the print path -- which is what
 * a share link should open. The actions row reflects that: "Open
 * Presentation" is promoted to the primary (`dark`) action, ahead of Copy
 * Share Link and Download PDF (both stay `outline`).
 *
 * WP4: a fourth action, Delete (`outline`, disabled-with-a-hint when
 * `!canDelete` -- see `ReportScreenProps.canDelete`'s doc comment), opens
 * the shared `ConfirmDeleteReportDialog`. This is the one place beyond a
 * row-level list action that this screen's scope grew past "read + inline
 * edit" -- deleting is destructive and irreversible, unlike every other
 * control here.
 *
 * WP5: a fifth action, "Edit Report" (`outline`, placed before Delete),
 * routes to the wizard (`${presentBase}/${dSafe.id}/edit`) -- the wizard
 * already resumes a report of ANY status (see `useWizard`'s `reportToDraft`),
 * so a published report's tasks/risks/priorities/narratives can now be
 * corrected through the same 6-step flow a draft uses, rather than only via
 * this screen's own handful of inline-editable fields (status/preparedFor/
 * period). Deliberately UNGATED (no `canEdit`/admin check, unlike Delete):
 * this screen's own inline fields are already editable by any signed-in
 * user today and fail server-side with a curated `mutationError` on a
 * permission violation, so gating only the wizard ENTRY POINT would be
 * inconsistent -- a non-owner would still reach the wizard, fill it out,
 * and only THEN discover they can't save, which is a worse experience than
 * today's inline-field failure, not a better one. A non-owner's wizard save
 * goes through the exact same write path as everything else in this app
 * (`POST /api/reports` -> `replace_reports`) and is rejected the exact same
 * way: RLS violation -> `mapPgError('forbidden')` -> curated "You don't have
 * permission to do that." -> `useWizard`'s `catch` renders it in the
 * wizard's own error banner, and the wizard stays mounted with the draft
 * intact (nothing is lost, the user can copy their edits out or just leave).
 * Delete stays gated (`canDelete`) because it is destructive and
 * irreversible in a way editing is not -- a rejected edit leaves the
 * published report exactly as it was; a rejected delete attempt has no such
 * "nothing happened" guarantee to lean on if the gate were ever wrong.
 *
 * Owns its own (small) Share-dialog AND delete-dialog UI state directly --
 * this route is simple enough (one param, one hook) that it doesn't need a
 * separate route-level orchestrator like DashboardPage/WizardPage.
 */
export function ReportScreen({ report, kind, onUpdateFields, periodError, mutationError, onDelete, canDelete, deleteHint }: ReportScreenProps) {
  const router = useRouter();
  const dSafe = report ?? emptyReportFallback(kind);
  const { onSched, total } = onSchedule(dSafe);
  const backHref = kind === 'daily' ? '/daily' : '/reports';
  const presentBase = kind === 'daily' ? '/daily' : '/reports';

  // WP2: the single source of this kind's section wording (see
  // lib/report-sections.ts's own doc comment) -- every section kicker
  // below reads `headings.*` instead of a hardcoded string or a
  // `kind === 'daily' ? ... : ...` ternary, so this screen and the deck
  // (ReportDeck.tsx) can never independently drift on what a section is
  // called.
  const headings = SECTION_HEADINGS[kind];

  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    },
    []
  );

  const copyShareLink = () => {
    const link = shareLinkFor(dSafe.id || null, kind);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setShareCopied(true);
    if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    shareCopyTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800);
  };

  const openPresentation = (print: boolean) => {
    if (!dSafe.id) return;
    const url = `${presentBase}/${dSafe.id}/present${print ? '?print=1' : ''}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /**
   * WP5: same-tab navigation into the wizard's resume flow -- mirrors
   * `DashboardPage.tsx`'s `onResumeDraft={(id) => router.push(...)}` (the
   * pre-existing convention for entering the wizard on an existing report),
   * NOT a new-tab `window.open` like `openPresentation` above (editing is a
   * primary, not a spawned-off, action). Guarded the same way
   * `openPresentation` is: a no-op while `dSafe` is still the null-guard
   * fallback (`report === null`, `dSafe.id === ''`), so a stray click in
   * that split-second window before `report` loads can't navigate to
   * `${presentBase}//edit`.
   */
  const openEdit = () => {
    if (!dSafe.id) return;
    router.push(`${presentBase}/${dSafe.id}/edit`);
  };

  /**
   * WP4: mirrors `ProjectDetailScreen.handleDelete` exactly, including its
   * "no navigation on success" posture -- `onDelete` (`useReports()`'s /
   * `useDailyReports()`'s non-optimistic `deleteReport`) only removes this
   * report from the hook's own `reports` state AFTER the repository call
   * resolves; the route wrapper's `notFound` effect, derived from that SAME
   * state, is the single place that redirects away, exactly once, once that
   * state change lands. Calling a router here too would double-navigate on
   * success, and doing so BEFORE the write resolves risks unmounting this
   * component mid-request on a failure, silently swallowing `deleteError` --
   * the exact Phase 8c SHOULD-FIX 2 bug class `useProjects.ts`'s
   * `deleteProject` doc comment documents. `setIsDeleting(false)` only runs
   * in the failure branch, not after success, for the same reason: on
   * success this component is about to unmount via that redirect, so
   * resetting it there would be a wasted render at best.
   */
  const handleDelete = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the report.');
      setIsDeleting(false);
    }
  };

  const taskRows = dSafe.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));
  // WP2: only computed for daily reports (a weekly keeps the flat
  // `taskRows` table above, unchanged) -- see groupTasksByClient's own doc
  // comment for why grouping is keyed on the `client` string, not
  // `projectId`.
  const clientTaskGroups = kind === 'daily' ? groupTasksByClient(dSafe.tasks) : [];
  // WP2: a weekly report always gets a Win section (its stat/label/
  // narrative render with the deck's same '—' fallback when blank -- "no
  // win this week" is itself meaningful status); a daily report only gets
  // one when it actually recorded a win -- see hasWin's own doc comment,
  // and buildDeckSlides's matching decision for the deck's Win slide.
  const showWin = kind === 'weekly' || hasWin(dSafe);

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>{report ? reportPeriodLabel(report) : kind === 'daily' ? 'Daily Report' : 'Report'}</span>
        <div className={styles.headerActions}>
          <Link href={backHref} className={styles.backLink}>
            &larr; Back to {kind === 'daily' ? 'Daily Reports' : 'Weekly Reports'}
          </Link>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.editRow}>
          <div style={{ width: 150 }}>
            <Select
              label="Status"
              options={[...STATUS_EDIT_OPTIONS]}
              value={dSafe.status}
              onChange={(value) => onUpdateFields({ status: value as ReportStatus })}
            />
          </div>
          <div style={{ width: 220 }}>
            <Input
              label="Prepared For"
              value={dSafe.preparedFor}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateFields({ preparedFor: e.target.value })}
            />
          </div>
          {dSafe.kind === 'daily' ? (
            <div style={{ width: 150 }}>
              <Input
                type="date"
                label="Date"
                value={dSafe.date}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateFields({ date: e.target.value })}
              />
              {periodError ? <div className={styles.fieldError}>{periodError}</div> : null}
            </div>
          ) : (
            <>
              <div style={{ width: 150 }}>
                <Input
                  type="date"
                  label="Week Start"
                  value={dSafe.weekStart}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateFields({ weekStart: e.target.value })}
                />
              </div>
              <div style={{ width: 150 }}>
                <Input
                  type="date"
                  label="Week End"
                  value={dSafe.weekEnd}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateFields({ weekEnd: e.target.value })}
                />
              </div>
              {periodError ? <div className={styles.fieldError}>{periodError}</div> : null}
            </>
          )}
        </div>
        <div className={mutationError ? styles.fieldError : styles.autosaveNote} role="status" aria-live="polite">
          {/* Post-review hardening round 2 (SHOULD-FIX G): render the actual
              curated server message (e.g. "You don't have permission to do
              that.", "This was changed by someone else since you loaded it.
              Reload and try again.") instead of a hardcoded generic string
              that discarded it -- TaskViewScreen already does this. */}
          {mutationError ?? 'Changes save automatically.'}
        </div>

        <div className={styles.actionsRow}>
          <div className={styles.actionsButtons}>
            <Button variant="dark" size="sm" onClick={() => openPresentation(false)}>
              Open Presentation
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
              Copy Share Link
            </Button>
            <Button variant="outline" size="sm" onClick={() => openPresentation(true)}>
              Download PDF
            </Button>
            <Button variant="outline" size="sm" onClick={openEdit}>
              Edit Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={!canDelete}
              title={!canDelete ? deleteHint : undefined}
            >
              Delete
            </Button>
          </div>
          {!canDelete && deleteHint ? <div className={styles.deleteHint}>{deleteHint}</div> : null}
        </div>

        <div className={styles.sectionKicker}>{headings.summary}</div>
        <p className={styles.narrative}>{dSafe.summaryNarrative}</p>

        <div className={styles.statsGrid}>
          <StatCard label="Tasks On Schedule" value={`${onSched} / ${total}`} />
          <StatCard label="Client Calls" value={String(dSafe.touchpoints.calls || 0)} />
          <StatCard label="Open Blockers" value={String(openBlockers(dSafe))} />
        </div>

        <div className={styles.sectionKicker}>{headings.tasks}</div>
        {kind === 'daily' ? (
          // WP2: a daily's defining shape is breadth across every client in
          // one day, so its tasks render as one heading + one table per
          // client (same `groupTasksByClient` derivation the deck's
          // "Tasks by Client" slide uses) instead of one flat table with a
          // repeating Client column.
          clientTaskGroups.map((group) => (
            <div key={group.client} className={styles.clientGroup}>
              <div className={styles.clientGroupHeading}>{group.client}</div>
              <Table
                columns={TASKS_BY_CLIENT_COLUMNS}
                rows={group.tasks.map((t) => ({
                  task: t.task,
                  status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
                  deadline: fmtDateShort(t.deadline),
                }))}
                dense
              />
            </div>
          ))
        ) : (
          <Table columns={TASK_COLUMNS} rows={taskRows} dense />
        )}

        <div className={styles.sectionKicker} style={{ marginTop: 26 }}>
          {headings.risks}
        </div>
        {dSafe.risks.length > 0 ? (
          <div className={styles.riskList}>
            {dSafe.risks.map((rk) => (
              <div key={rk.id} className={styles.riskCard}>
                <div className={styles.riskHeading}>
                  <span>{rk.client}</span>
                  <Badge tone={riskTone(rk.severity)}>{rk.severity}</Badge>
                </div>
                <div className={styles.riskDescription}>{rk.description}</div>
                <div className={styles.riskNextStep}>Next step: {rk.nextStep}</div>
              </div>
            ))}
          </div>
        ) : (
          // WP2: kind-aware empty-state copy, mirroring ReportDeck.tsx's
          // identical branch -- "No blockers today." for a single day.
          // The pre-existing weekly copy ("that week", not "this week") is
          // a faithful-port quirk left untouched; not this task's scope to
          // fix.
          <div className={styles.mutedNote}>{kind === 'daily' ? 'No blockers today.' : 'No open risks that week.'}</div>
        )}

        <div className={styles.sectionKicker} style={{ marginTop: 26 }}>
          {headings.priorities}
        </div>
        {dSafe.priorities.map((p) => (
          <div key={p.id} className={styles.priorityRow}>
            {p.text}
          </div>
        ))}

        {showWin ? (
          <>
            {/*
             * WP2: a read-only Win section -- the report screen previously
             * had none at all (it was the deck's exclusive slide). "Screen
             * and deck agree on methodology" is unachievable without one,
             * so this is the one place WP2 extends beyond pure re-wording:
             * see lib/report-sections.ts's SECTION_HEADINGS doc comment and
             * this component's `showWin` derivation above for exactly when
             * it renders. Stat/label/narrative render unconditionally
             * (matching ReportDeck.tsx's `win` slide byte-for-byte, only
             * the stat falls back to '—' when blank) rather than each
             * being individually hidden when empty.
             */}
            <div className={styles.sectionKicker} style={{ marginTop: 26 }}>
              {headings.win}
            </div>
            <div className={styles.winSection}>
              <div className={styles.winStat}>{dSafe.win.stat || '—'}</div>
              <div className={styles.winLabel}>{dSafe.win.label}</div>
              <p className={styles.winNarrative}>{dSafe.win.narrative}</p>
            </div>
          </>
        ) : null}
      </div>

      <ShareDialog
        open={shareOpen}
        reportId={dSafe.id || null}
        kind={kind}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={() => setShareOpen(false)}
      />

      <ConfirmDeleteReportDialog
        open={deleteOpen}
        report={report}
        isDeleting={isDeleting}
        error={deleteError}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
