'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { fmtDateShort } from '@/lib/format';
import type { MergedTaskEntry } from '@/lib/task-merge';
import { taskCardId } from './taskCardId';
import styles from './TaskCard.module.css';

export interface TaskCardProps {
  entry: MergedTaskEntry;
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
 *
 * WP4 (the access flip's task-surface follow-up): `useDraggable`'s own
 * `disabled` option is what makes a card the viewer can neither own nor is
 * assigned to (a pm/admin browsing under org-wide reads) non-draggable --
 * `disabled: true` makes dnd-kit return `listeners: undefined`, so the
 * pointer/touch/keyboard sensors never even see a drag start on this
 * element (verified against `@dnd-kit/core`'s own `useDraggable`
 * implementation). Clicking still opens the dialog either way -- `onOpen`
 * is never gated on drag capability -- `TaskDialog` itself is what renders
 * every field read-only for a card with no write capability at all (see
 * that component's own doc comment).
 */
export function TaskCard({ entry, onOpen, overlay = false }: TaskCardProps) {
  const { task, source } = entry;
  const canDrag = entry.canEditFull || entry.canEditAssigned;
  const id = taskCardId(source.reportId, task.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: !canDrag });

  const style = overlay
    ? undefined
    : {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.35 : 1,
      };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`${styles.card} ${overlay ? styles.overlay : ''} ${!overlay && !canDrag ? styles.readOnly : ''}`}
      data-status={task.status}
      style={style}
      onClick={overlay ? undefined : onOpen}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
    >
      <div className={styles.cardTask}>{task.task}</div>
      <div className={styles.cardMeta}>{task.client}</div>
      <div className={styles.cardFooter}>
        <span>{source.periodLabel}</span>
        <span>{fmtDateShort(task.deadline)}</span>
      </div>
      {/* WP4: explains why this card can't be dragged -- a pm/admin browsing
          a report they neither own nor are assigned a task on, under
          org-wide reads. Absent entirely for a normal, fully-editable card. */}
      {!overlay && !canDrag ? <div className={styles.readOnlyHint}>View only</div> : null}
    </div>
  );
}
