'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { withTaskStatus } from '@/lib/report-utils';
import type { Report, TaskStatus } from '@/lib/types';
import { allTasks, groupTasksByStatus } from '@/lib/view-utils';
import { KanbanBoard } from './KanbanBoard';
import { TaskList } from './TaskList';
import styles from './TaskViewScreen.module.css';

export interface TaskViewScreenProps {
  reports: Report[];
  onUpdateReportFields: (id: string, patch: Partial<Report>) => void;
}

type TaskViewMode = 'list' | 'kanban';

/**
 * `/tasks` -- every task across every report, in two modes. Owns its own
 * (small) `mode` toggle state directly, the same way `ReportScreen` owns
 * its Share-dialog state: this route is simple enough (no filters, one
 * `useReports()` call already made by the thin page wrapper) that a
 * separate route-level orchestrator would be pure ceremony.
 */
export function TaskViewScreen({ reports, onUpdateReportFields }: TaskViewScreenProps) {
  const router = useRouter();
  const [mode, setMode] = useState<TaskViewMode>('list');

  const entries = useMemo(() => allTasks(reports), [reports]);
  const grouped = useMemo(() => groupTasksByStatus(entries), [entries]);

  const handleViewReport = (id: string) => router.push(`/reports/${id}`);

  const handleTaskStatusChange = (reportId: string, taskId: string, status: TaskStatus) => {
    const report = reports.find((r) => r.id === reportId);
    if (!report) return;
    onUpdateReportFields(reportId, { tasks: withTaskStatus(report, taskId, status) });
  };

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>Tasks</span>
      </div>

      <div className={styles.content}>
        <p className={styles.subtitle}>Every task across every report, grouped by status.</p>

        <Tabs
          aria-label="Task view mode"
          value={mode}
          onChange={(value) => setMode(value as TaskViewMode)}
          items={[
            { value: 'list', label: 'List', content: <div className={styles.panel}><TaskList grouped={grouped} /></div> },
            {
              value: 'kanban',
              label: 'Kanban',
              content: (
                <div className={styles.panel}>
                  <KanbanBoard grouped={grouped} onViewReport={handleViewReport} onTaskStatusChange={handleTaskStatusChange} />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
