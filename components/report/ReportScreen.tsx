'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
}

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
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
 * Owns its own (small) Share-dialog UI state directly -- this route is
 * simple enough (one param, one hook) that it doesn't need a separate
 * route-level orchestrator like DashboardPage/WizardPage.
 */
export function ReportScreen({ report, kind, onUpdateFields, periodError, mutationError }: ReportScreenProps) {
  const dSafe = report ?? emptyReportFallback(kind);
  const { onSched, total } = onSchedule(dSafe);
  const backHref = kind === 'daily' ? '/daily' : '/';
  const presentBase = kind === 'daily' ? '/daily' : '/reports';

  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const taskRows = dSafe.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>{report ? reportPeriodLabel(report) : kind === 'daily' ? 'Daily Report' : 'Report'}</span>
        <div className={styles.headerActions}>
          <Link href={backHref} className={styles.backLink}>
            &larr; Back to {kind === 'daily' ? 'Daily Reports' : 'Dashboard'}
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
          <Button variant="dark" size="sm" onClick={() => openPresentation(false)}>
            Open Presentation
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
            Copy Share Link
          </Button>
          <Button variant="outline" size="sm" onClick={() => openPresentation(true)}>
            Download PDF
          </Button>
        </div>

        <div className={styles.sectionKicker}>Summary</div>
        <p className={styles.narrative}>{dSafe.summaryNarrative}</p>

        <div className={styles.statsGrid}>
          <StatCard label="Tasks On Schedule" value={`${onSched} / ${total}`} />
          <StatCard label="Client Calls" value={String(dSafe.touchpoints.calls || 0)} />
          <StatCard label="Open Blockers" value={String(openBlockers(dSafe))} />
        </div>

        <div className={styles.sectionKicker}>Task Status</div>
        <Table columns={TASK_COLUMNS} rows={taskRows} dense />

        <div className={styles.sectionKicker} style={{ marginTop: 26 }}>
          {'Risks & Blockers'}
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
          <div className={styles.mutedNote}>No open risks that week.</div>
        )}

        <div className={styles.sectionKicker} style={{ marginTop: 26 }}>
          {dSafe.kind === 'daily' ? 'Priorities' : "Next Week's Priorities"}
        </div>
        {dSafe.priorities.map((p) => (
          <div key={p.id} className={styles.priorityRow}>
            {p.text}
          </div>
        ))}
      </div>

      <ShareDialog
        open={shareOpen}
        reportId={dSafe.id || null}
        kind={kind}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
