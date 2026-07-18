'use client';

import { useDroppable } from '@dnd-kit/core';
import { Badge } from '@/components/ui/Badge';
import { taskTone } from '@/lib/report-utils';
import type { TaskStatus } from '@/lib/types';
import type { TaskEntry } from '@/lib/view-utils';
import { TaskCard } from './TaskCard';
import styles from './KanbanColumn.module.css';

export interface KanbanColumnProps {
  status: TaskStatus;
  entries: TaskEntry[];
  onViewReport: (id: string) => void;
}

/** One `useDroppable` zone keyed by `status` -- `KanbanBoard`'s `onDragEnd` reads the dropped-over `status` straight off `over.id`. */
export function KanbanColumn({ status, entries, onViewReport }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className={styles.column}>
      <div className={styles.heading}>
        <Badge tone={taskTone(status)}>{status}</Badge>
        <span className={styles.count}>{entries.length}</span>
      </div>
      <div ref={setNodeRef} className={`${styles.dropZone} ${isOver ? styles.dropZoneOver : ''}`}>
        {entries.length === 0 ? (
          <div className={styles.emptyState}>No tasks</div>
        ) : (
          entries.map((entry) => (
            <TaskCard
              key={`${entry.report.id}::${entry.task.id}`}
              entry={entry}
              onView={() => onViewReport(entry.report.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
