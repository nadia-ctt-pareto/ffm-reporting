'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import type { TaskEntry } from '@/lib/view-utils';
import { taskCardId } from './taskCardId';
import styles from './TaskCard.module.css';

export interface TaskCardProps {
  entry: TaskEntry;
  onView: () => void;
  /** Rendered inside `<DragOverlay>` -- the floating copy needs no drag ref/listeners of its own. */
  overlay?: boolean;
}

/**
 * A Kanban card is simultaneously a drag handle (`useDraggable`) and a
 * report link (`onView`). The `PointerSensor`'s `activationConstraint:
 * {distance: 8}` (configured on the board's `DndContext`) is what makes
 * both work off the same element: a plain click never moves the pointer
 * 8px, so dnd-kit never starts a drag and the native `click` fires
 * normally; a real drag swallows that trailing click itself (dnd-kit adds a
 * one-shot document `click` listener that stops propagation after a drag
 * ends), so `onView` never double-fires after a drop.
 */
export function TaskCard({ entry, onView, overlay = false }: TaskCardProps) {
  const { report, task } = entry;
  const id = taskCardId(report.id, task.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  const style = overlay
    ? undefined
    : {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.35 : 1,
      };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`${styles.card} ${overlay ? styles.overlay : ''}`}
      data-status={task.status}
      style={style}
      onClick={overlay ? undefined : onView}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
    >
      <div className={styles.cardTask}>{task.task}</div>
      <div className={styles.cardMeta}>{task.client}</div>
      <div className={styles.cardFooter}>
        <span>{fmtWeekLabel(report.weekStart, report.weekEnd)}</span>
        <span>{fmtDateShort(task.deadline)}</span>
      </div>
    </div>
  );
}
