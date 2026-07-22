'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import type { TaskEntry } from '@/lib/view-utils';
import { taskCardId } from './taskCardId';
import styles from './TaskCard.module.css';

export interface TaskCardProps {
  entry: TaskEntry;
  /** Task CRUD: opens the edit dialog for this card's task (was `onView`, which navigated to the parent report -- see this component's own doc comment for why that destination moved, not disappeared). */
  onOpen: () => void;
  /** Rendered inside `<DragOverlay>` -- the floating copy needs no drag ref/listeners of its own. */
  overlay?: boolean;
}

/**
 * A Kanban card is simultaneously a drag handle (`useDraggable`) and a
 * clickable task (`onOpen`, opens the edit dialog -- Task CRUD). The
 * `MouseSensor`'s `activationConstraint: {distance: 8}` / `TouchSensor`'s
 * `{delay: 250, tolerance: 8}` (configured on the board's `DndContext`) is
 * what makes both work off the same element: a plain click/tap never
 * satisfies either activation constraint, so dnd-kit never starts a drag
 * and the native `click` fires normally; a real drag swallows that
 * trailing click itself (dnd-kit adds a one-shot document `click` listener
 * that stops propagation after a drag ends), so `onOpen` never double-fires
 * after a drop. Task CRUD deliberately adds NO `onKeyDown` here (a
 * temptation, for parity with `TaskList`'s row keyboard handling) --
 * `KeyboardSensor`'s own defaults already bind Enter/Space on a focused
 * draggable to pick-up/drop, and layering a competing Enter/Space handler
 * on the same element would fight that, not complement it. A keyboard user
 * opens the edit dialog from List mode instead; Kanban's keyboard
 * interaction stays drag-only, unchanged from before this feature.
 */
export function TaskCard({ entry, onOpen, overlay = false }: TaskCardProps) {
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
      onClick={overlay ? undefined : onOpen}
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
