'use client';

import { Badge } from '@/components/ui/Badge';
import { taskTone } from '@/lib/report-utils';
import type { MergedTaskEntry } from '@/lib/task-merge';
import styles from './TaskChip.module.css';

export interface TaskChipProps {
  entry: MergedTaskEntry;
  /** Navigates to `/reports/[id]` or `/daily/[id]` -- only ever called when `entry.source.canOpen` (this component itself gates the click, see below). */
  onOpen: (reportId: string, kind: 'weekly' | 'daily') => void;
}

/**
 * WP5 (calendar task lens): one task, rendered as a small status-toned chip
 * inside a `WeekGrid`/`MonthGrid` day cell -- reuses the existing `Badge`
 * tones (`taskTone`), same as `TaskList`/`KanbanBoard` already do, so a
 * task's colour means the same thing everywhere in this app. Shared by both
 * grids so the "clickable vs. inert" rule can't drift between them: when
 * `entry.source.canOpen` is false (an assigned-elsewhere task, see
 * `MergedTaskEntry`'s own doc comment, lib/task-merge.ts), this renders a
 * plain, non-interactive `<span>` -- there is nowhere for a click to go --
 * instead of a `<button>` that would look actionable but silently do
 * nothing.
 */
export function TaskChip({ entry, onOpen }: TaskChipProps) {
  const { task, source } = entry;
  const title = `${task.client}: ${task.task} (${source.periodLabel})`;

  if (!source.canOpen) {
    return (
      <span className={`${styles.chip} ${styles.chipStatic}`} title={`${title} -- not shared with you`}>
        <Badge tone={taskTone(task.status)}>{task.status}</Badge>
        <span className={styles.chipLabel}>{task.task}</span>
      </span>
    );
  }

  return (
    <button type="button" className={styles.chip} title={title} onClick={() => onOpen(source.reportId, source.kind)}>
      <Badge tone={taskTone(task.status)}>{task.status}</Badge>
      <span className={styles.chipLabel}>{task.task}</span>
    </button>
  );
}
