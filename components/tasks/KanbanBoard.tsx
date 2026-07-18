'use client';

import { useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
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
 * scroll containers. `PointerSensor`'s 8px activation distance is what lets
 * a plain click on a card fall through to its own `onClick` (navigate)
 * instead of starting a drag; `KeyboardSensor` (default codes: Space/Enter
 * to pick up and drop, arrow keys to move between droppables, Escape to
 * cancel) gives the same interaction without a pointer.
 */
export function KanbanBoard({ grouped, onViewReport, onTaskStatusChange }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
