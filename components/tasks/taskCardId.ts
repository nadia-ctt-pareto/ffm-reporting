/**
 * A Kanban card's drag identity is the composite `${reportId}::${taskId}` --
 * a task's status lives on its *parent report* (`Report.tasks[]`), so a
 * drop needs both ids to know which report to patch. Shared by `TaskCard`
 * (constructs it for `useDraggable`) and `KanbanBoard` (parses it back out
 * in `onDragEnd`).
 */
export function taskCardId(reportId: string, taskId: string): string {
  return `${reportId}::${taskId}`;
}

export function parseTaskCardId(id: string): { reportId: string; taskId: string } {
  const sep = id.indexOf('::');
  return { reportId: id.slice(0, sep), taskId: id.slice(sep + 2) };
}
