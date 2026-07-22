'use client';

import type { ChangeEvent } from 'react';
import { PolishPanel } from '@/components/ai/PolishPanel';
import { PolishTrigger } from '@/components/ai/PolishTrigger';
import { usePolishField } from '@/components/ai/usePolishField';
import { Button } from '@/components/ui/Button';
import { IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ImportPanel } from '@/components/wizard/ImportPanel';
import type { ImportCandidateProps } from '@/components/wizard/ImportPanel';
import type { CarryForwardNoteState } from '@/components/wizard/useWizard';
import { TASK_STATUS_OPTIONS } from '@/lib/constants';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { Draft, Task } from '@/lib/types';
import styles from './Step.module.css';

export interface StepTasksProps {
  draft: Draft;
  updateTask: <F extends keyof Task>(id: string, field: F, value: Task[F]) => void;
  removeTask: (id: string) => void;
  addTask: () => void;
  /** Phase 6a: known project names, offered as native datalist autocomplete on the Client field. */
  clientSuggestions?: string[];
  sourceOptions: { value: string; label: string }[];
  importTaskSource: string;
  onImportTaskSourceChange: (value: string) => void;
  importTaskCandidates: ImportCandidateProps[];
  importTaskDisabled: boolean;
  importSelectedTasks: () => void;
  /** Auto carry-forward on a NEW report: `null` when nothing was auto-imported (or after Dismiss/Undo) -- see useWizard.ts. */
  carryForwardNote: CarryForwardNoteState | null;
  onDismissCarryForward: () => void;
  onUndoCarryForward: () => void;
}

/**
 * Auto carry-forward on a NEW report: builds the note's copy, e.g. "Carried
 * forward 4 unfinished tasks from Jul 22 — 3 In Progress, 1 Blocked." Only
 * non-zero status counts are listed (a carry that pulled in only Blocked
 * tasks, say, never reads "... — 0 In Progress, 1 Blocked").
 */
function carryForwardMessage(note: CarryForwardNoteState): string {
  const total = note.blockedCount + note.inProgressCount;
  const parts: string[] = [];
  if (note.inProgressCount > 0) parts.push(`${note.inProgressCount} In Progress`);
  if (note.blockedCount > 0) parts.push(`${note.blockedCount} Blocked`);
  return `Carried forward ${total} unfinished task${total === 1 ? '' : 's'} from ${note.sourceLabel} — ${parts.join(', ')}.`;
}

interface TaskRowProps {
  task: Task;
  updateTask: <F extends keyof Task>(id: string, field: F, value: Task[F]) => void;
  removeTask: (id: string) => void;
  clientSuggestions?: string[];
  kind: Draft['kind'];
  period: string;
}

/**
 * Row-alignment fix (Nav IA polish-affordance pass): one row's worth of
 * `usePolishField` state has to live in a component of its own -- React's
 * rules of hooks forbid calling a hook a variable number of times inside a
 * single component's render (which is what calling `usePolishField` inline
 * inside `draft.tasks.map(...)` back in `StepTasks` would do, since the
 * number of tasks changes across renders). Extracting one `TaskRow` per
 * task, each its own component instance keyed by `task.id`, is what makes
 * "call the hook once per field" (see usePolishField's own header comment)
 * actually legal here. This also happens to be exactly the shape the
 * PolishTrigger/PolishPanel split needs anyway: `PolishPanel` renders as
 * this row's own grid sibling (`grid-column: 1 / -1`), immediately after
 * the Remove button -- not nested inside the Task field's wrapper -- so it
 * spans the row's full width instead of just the Task column's.
 */
function TaskRow({ task: t, updateTask, removeTask, clientSuggestions, kind, period }: TaskRowProps) {
  const polish = usePolishField({
    field: 'taskTitle',
    value: t.task,
    context: { kind, period, client: t.client, status: t.status },
    onAccept: (next) => updateTask(t.id, 'task', next),
  });

  return (
    <div className={styles.taskRow}>
      <Input
        label="Client"
        value={t.client}
        onChange={(e: ChangeEvent<HTMLInputElement>) => updateTask(t.id, 'client', e.target.value)}
        suggestions={clientSuggestions}
      />
      <div className={styles.fieldWithPolish}>
        <Input
          label="Task"
          value={t.task}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateTask(t.id, 'task', e.target.value)}
        />
        <PolishTrigger state={polish} />
      </div>
      <Select
        label="Status"
        options={[...TASK_STATUS_OPTIONS]}
        value={t.status}
        onChange={(value) => updateTask(t.id, 'status', value as Task['status'])}
      />
      <Input
        type="date"
        label="Deadline"
        value={t.deadline}
        onChange={(e: ChangeEvent<HTMLInputElement>) => updateTask(t.id, 'deadline', e.target.value)}
      />
      <Button variant="danger" size="sm" icon={<IconTrash />} onClick={() => removeTask(t.id)}>
        Remove
      </Button>
      <PolishPanel state={polish} />
      {/* Task completion date: the row already has 5 dense columns (Client/
          Task/Status/Deadline/Remove) -- rather than widen `.taskRow`'s fixed
          grid-template-columns for every row (completed or not), this field
          renders ONLY for a Complete-status row, as a further grid sibling
          spanning the full row width (the same `grid-column: 1 / -1`
          technique `PolishPanel` above already uses to add an extra row
          below the 5 explicit column tracks). `updateTask`'s own 'status'
          branch (useWizard.ts) already stamps this the moment Status
          changes to Complete -- this field is for the (less common)
          after-the-fact correction, not the primary write path. */}
      {t.status === 'Complete' ? (
        <div className={styles.completedOnField}>
          <Input
            type="date"
            label="Completed On"
            value={t.completedAt ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateTask(t.id, 'completedAt', e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Ported from design-source lines 138-171. */
export function StepTasks({
  draft,
  updateTask,
  removeTask,
  addTask,
  clientSuggestions,
  sourceOptions,
  importTaskSource,
  onImportTaskSourceChange,
  importTaskCandidates,
  importTaskDisabled,
  importSelectedTasks,
  carryForwardNote,
  onDismissCarryForward,
  onUndoCarryForward,
}: StepTasksProps) {
  const period = draftPeriodLabel(draft);
  return (
    <div>
      <div className={styles.title}>Task Status</div>

      {carryForwardNote ? (
        <div className={styles.carryForwardNote}>
          <p className={styles.carryForwardCopy}>{carryForwardMessage(carryForwardNote)}</p>
          <div className={styles.carryForwardActions}>
            <Button variant="outline" size="sm" onClick={onUndoCarryForward}>
              Undo
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismissCarryForward}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <ImportPanel
        kicker="Import Pending Tasks From a Prior Report"
        emptyMessage="No pending tasks from that report to import."
        sourceOptions={sourceOptions}
        sourceId={importTaskSource}
        onSourceChange={onImportTaskSourceChange}
        candidates={importTaskCandidates}
        onImport={importSelectedTasks}
        disabled={importTaskDisabled}
      />

      <div className={styles.rowsList}>
        {draft.tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            updateTask={updateTask}
            removeTask={removeTask}
            clientSuggestions={clientSuggestions}
            kind={draft.kind}
            period={period}
          />
        ))}
      </div>
      <Button variant="accent" size="sm" icon={<IconPlus />} onClick={addTask}>
        Add Task
      </Button>
    </div>
  );
}
