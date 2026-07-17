'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, taskTone } from '@/lib/report-utils';
import type { Draft } from '@/lib/types';
import styles from './StepReview.module.css';

export interface StepReviewProps {
  draft: Draft;
  onPublish: () => void;
}

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

/** Ported from design-source lines 266-309 (wizardNotPublished branch). */
export function StepReview({ draft, onPublish }: StepReviewProps) {
  const { onSched, total } = onSchedule(draft);
  const taskRows = draft.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  return (
    <div>
      <div className={styles.title}>{'Review & Export'}</div>
      <div className={styles.subtitle}>
        {fmtWeekLabel(draft.weekStart, draft.weekEnd)} — for {draft.preparedFor}
      </div>

      <p className={styles.narrative}>{draft.summaryNarrative}</p>

      <div className={styles.statsGrid}>
        <StatCard label="Tasks On Schedule" value={`${onSched} / ${total}`} />
        <StatCard label="Client Calls" value={String(draft.touchpoints.calls || 0)} />
        <StatCard label="Open Blockers" value={String(openBlockers(draft))} />
      </div>

      <div className={styles.kicker}>Task Status</div>
      <Table columns={TASK_COLUMNS} rows={taskRows} dense />

      <div className={styles.kicker} style={{ marginTop: 28 }}>
        {'Risks & Blockers'}
      </div>
      {draft.risks.length > 0 ? (
        <div className={styles.riskList}>
          {draft.risks.map((rk) => (
            <div key={rk.id} className={styles.riskCard}>
              <div className={styles.riskHeading}>
                {rk.client} — {rk.severity}
              </div>
              <div className={styles.riskDescription}>{rk.description}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.mutedNote}>No open risks this week.</div>
      )}

      <div className={styles.kicker} style={{ marginTop: 28 }}>
        {"Next Week's Priorities"}
      </div>
      {draft.priorities.map((p) => (
        <div key={p.id} className={styles.priorityRow}>
          {p.text}
        </div>
      ))}

      <div className={styles.publishRow}>
        <Button variant="primary" size="lg" onClick={onPublish}>
          Publish Report
        </Button>
      </div>
    </div>
  );
}
