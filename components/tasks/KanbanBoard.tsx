'use client';

import { useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import { TASK_STATUS_ORDER } from '@/lib/view-utils';
import type { TaskEntry } from '@/lib/view-utils';
import type { TaskStatus } from '@/lib/types';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { parseTaskCardId, taskCardId } from './taskCardId';
import styles from './KanbanBoard.module.css';

export interface KanbanBoardProps {
  grouped: Record<TaskStatus, TaskEntry[]>;
  onViewReport: (id: string) => void;
  onTaskStatusChange: (reportId: string, taskId: string, status: TaskStatus) => void;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUS_ORDER as string[]).includes(value);
}

/**
 * One `DndContext` for the whole board: three `useDroppable` columns keyed
 * by `TaskStatus`, `useDraggable` cards keyed by the composite
 * `${reportId}::${taskId}` id (see `taskCardId`), and a `DragOverlay` for
 * the floating card -- rendering the dragged card in a portal at the
 * `DndContext` root avoids any clipping/z-index fights with the shell's
 * scroll containers.
 *
 * Mobile P5: split what used to be a single `PointerSensor` into
 * `MouseSensor` (unchanged 8px activation distance -- a plain click never
 * moves the pointer 8px, so it falls through to the card's own `onClick`
 * instead of starting a drag) and `TouchSensor` (a 250ms `delay` +
 * 8px `tolerance` instead of distance). The delay is what makes a
 * touch-drag on a card scroll the page by default: dnd-kit only claims the
 * touch as a drag after the delay elapses without the finger moving more
 * than `tolerance`px, so a normal scroll swipe (which moves immediately)
 * is never hijacked, while a deliberate press-and-hold still drags (paired
 * with `TaskCard.module.css`'s `touch-action: manipulation`, which is what
 * actually lets the browser's native touch-scroll run at all while a
 * pointer is down on a card -- the old `touch-action: none` blocked page
 * scroll entirely on any card touch). `KeyboardSensor` (default codes:
 * Space/Enter to pick up and drop, arrow keys to move between droppables,
 * Escape to cancel) is unchanged.
 */
export function KanbanBoard({ grouped, onViewReport, onTaskStatusChange }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const allEntries = TASK_STATUS_ORDER.flatMap((status) => grouped[status]);
  const activeEntry = activeId
    ? (allEntries.find((entry) => taskCardId(entry.report.id, entry.task.id) === activeId) ?? null)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !isTaskStatus(over.id)) return;
    const nextStatus = over.id;
    const { reportId, taskId } = parseTaskCardId(String(active.id));
    const currentEntry = allEntries.find((entry) => entry.report.id === reportId && entry.task.id === taskId);
    if (!currentEntry || currentEntry.task.status === nextStatus) return;
    onTaskStatusChange(reportId, taskId, nextStatus);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className={styles.board}>
        {TASK_STATUS_ORDER.map((status) => (
          <KanbanColumn key={status} status={status} entries={grouped[status]} onViewReport={onViewReport} />
        ))}
      </div>
      <DragOverlay>{activeEntry ? <TaskCard entry={activeEntry} onView={() => {}} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
