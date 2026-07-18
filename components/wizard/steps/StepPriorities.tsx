'use client';

import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ImportPanel } from '@/components/wizard/ImportPanel';
import type { ImportCandidateProps } from '@/components/wizard/ImportPanel';
import type { Draft, Priority } from '@/lib/types';
import styles from './Step.module.css';

export interface StepPrioritiesProps {
  draft: Draft;
  updatePriority: <F extends keyof Priority>(id: string, field: F, value: Priority[F]) => void;
  removePriority: (id: string) => void;
  addPriority: () => void;
  sourceOptions: { value: string; label: string }[];
  importPrioritySource: string;
  onImportPrioritySourceChange: (value: string) => void;
  importPriorityCandidates: ImportCandidateProps[];
  importPriorityDisabled: boolean;
  importSelectedPriorities: () => void;
}

/**
 * Ported from design-source lines 234-264. Phase 4: the title is
 * kind-aware ("next week" only makes sense for a weekly draft) --
 * `ReportScreen`/`ReportDeck` already made the same "Priorities" vs. "Next
 * Week's Priorities" call for the read-only display; this is the wizard's
 * side of that.
 */
export function StepPriorities({
  draft,
  updatePriority,
  removePriority,
  addPriority,
  sourceOptions,
  importPrioritySource,
  onImportPrioritySourceChange,
  importPriorityCandidates,
  importPriorityDisabled,
  importSelectedPriorities,
}: StepPrioritiesProps) {
  return (
    <div>
      <div className={styles.title}>{draft.kind === 'daily' ? 'Priorities' : "Next Week's Priorities"}</div>

      <ImportPanel
        kicker="Import Unfinished Priorities From a Prior Report"
        emptyMessage="No unfinished priorities from that report to import."
        sourceOptions={sourceOptions}
        sourceId={importPrioritySource}
        onSourceChange={onImportPrioritySourceChange}
        candidates={importPriorityCandidates}
        onImport={importSelectedPriorities}
        disabled={importPriorityDisabled}
      />

      <div className={styles.rowsList}>
        {draft.priorities.map((p, i) => (
          <div key={p.id} className={styles.priorityRow}>
            <Input
              label={`Priority ${i + 1}`}
              value={p.text}
              onChange={(e: ChangeEvent<HTMLInputElement>) => updatePriority(p.id, 'text', e.target.value)}
            />
            <Button variant="ghost" size="sm" onClick={() => removePriority(p.id)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addPriority}>
        Add Priority
      </Button>
    </div>
  );
}
