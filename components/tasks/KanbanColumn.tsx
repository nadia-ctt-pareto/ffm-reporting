'use client';

import { useDroppable } from '@dnd-kit/core';
import { Badge } from '@/components/ui/Badge';
import { taskTone } from '@/lib/report-utils';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { TaskStatus } from '@/lib/types';
import { TaskCard } from './TaskCard';
import { taskCardId } from './taskCardId';
import styles from './KanbanColumn.module.css';

export interface KanbanColumnProps {
  status: TaskStatus;
  entries: MergedTaskEntry[];
  /** Task CRUD: opens the edit dialog for a clicked card (was `onViewReport`, which navigated -- see TaskCard's own doc comment). */
  onTaskOpen: (entry: MergedTaskEntry) => void;
}

/** One `useDroppable` zone keyed by `status` -- `KanbanBoard`'s `onDragEnd` reads the dropped-over `status` straight off `over.id`. */
export function KanbanColumn({ status, entries, onTaskOpen }: KanbanColumnProps) {
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
            <TaskCard key={taskCardId(entry.source.reportId, entry.task.id)} entry={entry} onOpen={() => onTaskOpen(entry)} />
          ))
        )}
      </div>
    </div>
  );
}
