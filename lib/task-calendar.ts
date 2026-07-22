// WP5 (calendar task lens): pure derivation selectors over `MergedTaskEntry[]`
// (lib/task-merge.ts) -- no React, no storage, style of lib/view-utils.ts/
// lib/calendar.ts. Report bars stay completely untouched (they're still
// `reportsOverlappingRange` over the caller's own `Report[]`, see
// WeekGrid.tsx/MonthGrid.tsx) -- this module only powers the NEW task-chip
// layer the Calendar screen draws on top.

import type { MergedTaskEntry } from './task-merge';

/**
 * Which date field a task's calendar position is read off. Deliberately
 * three separate, single-purpose values rather than one combined "activity
 * date" -- a task can have a deadline that already passed while it's still
 * open (no completedAt), and showing it under the WRONG lens would
 * misrepresent when it's actually due/was made/was finished.
 */
export type TaskLens = 'deadline' | 'created' | 'completed';

export const TASK_LENS_OPTIONS: { value: TaskLens; label: string }[] = [
  { value: 'deadline', label: 'Deadline' },
  { value: 'created', label: 'Created' },
  { value: 'completed', label: 'Completed' },
];

/**
 * The ISO date `entry`'s task should be plotted under, for `lens` -- ''
 * (never a fabricated fallback date) when the task has no recorded value
 * for that lens. Mirrors this codebase's established "honest-empty, never
 * invent a date the source data doesn't have" posture -- see
 * lib/task-schedule.ts's header comment for the identical principle
 * applied to completion-timing inference.
 */
export function taskLensDate(entry: MergedTaskEntry, lens: TaskLens): string {
  if (lens === 'deadline') return entry.task.deadline || '';
  if (lens === 'completed') return entry.task.completedAt || '';
  return entry.task.createdAt || '';
}

/**
 * Groups `entries` by their `taskLensDate` under `lens`, restricted to
 * `[rangeStart, rangeEnd]` (inclusive, ISO `localeCompare` -- CLAUDE.md
 * "Conventions", never `Date` math). An entry with no date for `lens` is
 * simply absent from every group -- never bucketed under a guessed day
 * (the same posture the Schedule view takes for timing it can't infer).
 *
 * Keyed by a plain ISO date string, not a richer per-day structure, so a
 * later swimlane-by-assignee view is a RE-GROUP of this same map, not a
 * re-model: group each day's array again by `entry.task.assigneeId` --
 * nothing here needs to change for that.
 */
export function tasksByDay(
  entries: MergedTaskEntry[],
  rangeStart: string,
  rangeEnd: string,
  lens: TaskLens
): Record<string, MergedTaskEntry[]> {
  const grouped: Record<string, MergedTaskEntry[]> = {};
  for (const entry of entries) {
    const date = taskLensDate(entry, lens);
    if (!date) continue;
    if (date.localeCompare(rangeStart) < 0 || date.localeCompare(rangeEnd) > 0) continue;
    (grouped[date] ??= []).push(entry);
  }
  return grouped;
}
