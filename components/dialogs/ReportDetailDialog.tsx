'use client';

import type { ChangeEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { STATUS_EDIT_OPTIONS } from '@/lib/constants';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, taskTone } from '@/lib/report-utils';
import type { Report, ReportStatus } from '@/lib/types';
import styles from './ReportDetailDialog.module.css';

export interface ReportDetailDialogProps {
  report: Report | null;
  open: boolean;
  onClose: () => void;
  onUpdateFields: (patch: Partial<Report>) => void;
  onShare: () => void;
  onPdf: () => void;
}

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/**
 * Line 682 (dSafe): fallback so the dialog body can render safely even
 * while `report` is briefly null (e.g. during the dialog's close transition).
 */
const EMPTY_REPORT_FALLBACK: Pick<
  Report,
  'preparedFor' | 'weekStart' | 'weekEnd' | 'status' | 'summaryNarrative' | 'tasks' | 'risks' | 'priorities' | 'touchpoints'
> = {
  preparedFor: '',
  weekStart: '',
  weekEnd: '',
  status: 'Draft',
  summaryNarrative: '',
  tasks: [],
  risks: [],
  priorities: [],
  touchpoints: { calls: 0, emails: 0, escalations: 0, narrative: '' },
};

export function ReportDetailDialog({ report, open, onClose, onUpdateFields, onShare, onPdf }: ReportDetailDialogProps) {
  const dSafe = report ?? EMPTY_REPORT_FALLBACK;
  const { onSched, total } = onSchedule(dSafe);

  const taskRows = dSafe.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  const title = report ? fmtWeekLabel(report.weekStart, report.weekEnd) : '';

  return (
    <Dialog open={open} onClose={onClose} title={title} width={960}>
      <div className={styles.scroll}>
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
                  {rk.client} — {rk.severity}
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

        <div className={styles.footer}>
          <Button variant="outline" size="sm" onClick={onShare}>
            Copy Share Link
          </Button>
          <Button variant="outline" size="sm" onClick={onPdf}>
            Download PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
