'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { ReportDeck, DECK_SLIDE_WIDTH, DECK_TOTAL_HEIGHT } from '@/components/report/ReportDeck';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { STATUS_EDIT_OPTIONS } from '@/lib/constants';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, riskTone, taskTone } from '@/lib/report-utils';
import type { Report, ReportStatus } from '@/lib/types';
import styles from './ReportScreen.module.css';

export interface ReportScreenProps {
  report: Report | null;
  onUpdateFields: (patch: Partial<Report>) => void;
}

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/** Thumbnail scale for the PDF-preview filmstrip -- a purely screen-only UI convenience. */
const PREVIEW_SCALE = 0.25;

/**
 * Faithful-port null-guard so this can render safely even while `report` is
 * briefly null (mirrors the old ReportDetailDialog's `dSafe`), extended to
 * every `Report` field since this screen also feeds `<ReportDeck>` (which
 * needs the full shape) for the PDF preview.
 */
const EMPTY_REPORT_FALLBACK: Report = {
  id: '',
  weekStart: '',
  weekEnd: '',
  status: 'Draft',
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

/**
 * `/reports/[id]` -- the full report screen, promoted from the old
 * ReportDetailDialog (deleted, see CLAUDE.md). Editable
 * status/preparedFor/weekStart/weekEnd autosave via `onUpdateFields`
 * (optimistic + fresh `updatedAt`, see useReports); everything else
 * (stats, tasks, risks, priorities) stays read-only display, same scope as
 * the old Detail dialog. Adds an actions row (Copy Share Link, Download
 * PDF, Open Presentation) and a PDF preview -- the real `<ReportDeck>`
 * rendered scaled-down as a thumbnail filmstrip, so the preview and the
 * exported PDF can never drift apart.
 *
 * Owns its own (small) Share-dialog UI state directly -- this route is
 * simple enough (one param, one hook) that it doesn't need a separate
 * route-level orchestrator like DashboardPage/WizardPage.
 */
export function ReportScreen({ report, onUpdateFields }: ReportScreenProps) {
  const dSafe = report ?? EMPTY_REPORT_FALLBACK;
  const { onSched, total } = onSchedule(dSafe);

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
    const link = shareLinkFor(dSafe.id || null);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setShareCopied(true);
    if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    shareCopyTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800);
  };

  const openPresentation = (print: boolean) => {
    if (!dSafe.id) return;
    const url = `/reports/${dSafe.id}/present${print ? '?print=1' : ''}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const taskRows = dSafe.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  const previewWidth = Math.round(DECK_SLIDE_WIDTH * PREVIEW_SCALE);
  const previewHeight = Math.round(DECK_TOTAL_HEIGHT * PREVIEW_SCALE);

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>{report ? fmtWeekLabel(report.weekStart, report.weekEnd) : 'Report'}</span>
        <div className={styles.headerActions}>
          <Link href="/" className={styles.backLink}>
            &larr; Back to Dashboard
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
        </div>
        <div className={styles.autosaveNote}>Changes save automatically.</div>

        <div className={styles.actionsRow}>
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
            Copy Share Link
          </Button>
          <Button variant="outline" size="sm" onClick={() => openPresentation(true)}>
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => openPresentation(false)}>
            Open Presentation
          </Button>
        </div>

        <div className={styles.sectionKicker}>PDF Preview</div>
        <div className={styles.previewViewport} style={{ width: previewWidth, height: previewHeight }}>
          <div
            className={styles.previewScaler}
            style={{ width: DECK_SLIDE_WIDTH, height: DECK_TOTAL_HEIGHT, transform: `scale(${PREVIEW_SCALE})` }}
          >
            <ReportDeck report={dSafe} />
          </div>
        </div>

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
          {"Next Week's Priorities"}
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
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
