import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort } from '@/lib/format';
import { taskTone } from '@/lib/report-utils';
import { TASK_STATUS_ORDER } from '@/lib/view-utils';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { TaskStatus } from '@/lib/types';
import styles from './TaskList.module.css';

export interface TaskListProps {
  grouped: Record<TaskStatus, MergedTaskEntry[]>;
  /** Task CRUD: opens the edit dialog for the clicked row's task. */
  onTaskClick: (entry: MergedTaskEntry) => void;
}

const COLUMNS: TableColumn[] = [
  { key: 'task', label: 'Task' },
  { key: 'client', label: 'Client' },
  // WP4: relabeled from "Report Week" -- a row can now be sourced from a
  // daily report too (an assigned-elsewhere task, see MergedTaskEntry's own
  // doc comment), so "Week" stopped being accurate for every row.
  { key: 'report', label: 'Report' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * List mode: every task grouped by status, in `TASK_STATUS_ORDER` (Blocked
 * -> In Progress -> Complete). Task CRUD: clicking anywhere in a row opens
 * the edit dialog (`onTaskClick`, via `Table`'s opt-in `onRowClick`) --
 * `TaskDialog` itself decides whether that dialog is editable (own report),
 * narrowly editable (assigned elsewhere), or fully read-only (neither), see
 * that component's own doc comment (WP4). The "View Report" link in the
 * actions column only renders when `entry.source.canOpen` is true (WP4) --
 * an assigned-elsewhere task's parent report genuinely has nowhere for that
 * link to go; a muted label explains why the row is here despite that.
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
                rows={entries.map((entry) => ({
                  task: entry.task.task,
                  client: entry.task.client,
                  report: entry.source.periodLabel,
                  deadline: fmtDateShort(entry.task.deadline),
                  actions: entry.source.canOpen ? (
                    <Link
                      href={entry.source.kind === 'weekly' ? `/reports/${entry.source.reportId}` : `/daily/${entry.source.reportId}`}
                      className={styles.rowAction}
                      onClick={(e) => e.stopPropagation()}
                    >
                      View Report
                    </Link>
                  ) : (
                    <span className={styles.noAccessLabel}>Not shared</span>
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
