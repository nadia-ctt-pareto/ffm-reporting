'use client';

import type { ChangeEvent } from 'react';
import { PolishButton } from '@/components/ai/PolishButton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ImportPanel } from '@/components/wizard/ImportPanel';
import type { ImportCandidateProps } from '@/components/wizard/ImportPanel';
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
}: StepTasksProps) {
  const period = draftPeriodLabel(draft);
  return (
    <div>
      <div className={styles.title}>Task Status</div>

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
          <div key={t.id} className={styles.taskRow}>
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
              <PolishButton
                field="taskTitle"
                value={t.task}
                context={{ kind: draft.kind, period, client: t.client, status: t.status }}
                onAccept={(next) => updateTask(t.id, 'task', next)}
              />
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
            <Button variant="ghost" size="sm" onClick={() => removeTask(t.id)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addTask}>
        Add Task
      </Button>
    </div>
  );
}
