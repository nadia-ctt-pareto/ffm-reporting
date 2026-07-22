import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { taskTone } from '@/lib/report-utils';
import type { TaskStatus } from '@/lib/types';
import { TASK_STATUS_ORDER } from '@/lib/view-utils';
import type { TaskEntry } from '@/lib/view-utils';
import styles from './TaskList.module.css';

export interface TaskListProps {
  grouped: Record<TaskStatus, TaskEntry[]>;
  /** Task CRUD: opens the edit dialog for the clicked row's task. */
  onTaskClick: (entry: TaskEntry) => void;
}

const COLUMNS: TableColumn[] = [
  { key: 'task', label: 'Task' },
  { key: 'client', label: 'Client' },
  { key: 'week', label: 'Report Week' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * List mode: every task grouped by status, in `TASK_STATUS_ORDER` (Blocked
 * -> In Progress -> Complete). Task CRUD: clicking anywhere in a row now
 * opens the edit dialog (`onTaskClick`, via `Table`'s opt-in `onRowClick`)
 * instead of navigating -- the old "click row -> view report" destination
 * is kept as the separate "View Report" link in the actions column, which
 * stops its own click from bubbling up into the row's `onRowClick` (see
 * that prop's doc comment in Table.tsx).
 */
export function TaskList({ grouped, onTaskClick }: TaskListProps) {
  return (
    <div className={styles.groups}>
      {TASK_STATUS_ORDER.map((status) => {
        const entries = grouped[status];
        return (
          <section key={status} className={styles.group}>
            <div className={styles.groupHeading}>
              <Badge tone={taskTone(status)}>{status}</Badge>
              <span className={styles.groupCount}>{entries.length}</span>
            </div>
            {entries.length === 0 ? (
              <div className={styles.emptyState}>No {status.toLowerCase()} tasks.</div>
            ) : (
              <Table
                dense
                stacked
                columns={COLUMNS}
                onRowClick={(index) => onTaskClick(entries[index])}
                rows={entries.map(({ report, task }) => ({
                  task: task.task,
                  client: task.client,
                  week: fmtWeekLabel(report.weekStart, report.weekEnd),
                  deadline: fmtDateShort(task.deadline),
                  actions: (
                    <Link href={`/reports/${report.id}`} className={styles.rowAction} onClick={(e) => e.stopPropagation()}>
                      View Report
                    </Link>
                  ),
                }))}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
