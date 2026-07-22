'use client';

import type { ChangeEvent } from 'react';
import { PolishPanel } from '@/components/ai/PolishPanel';
import { PolishTrigger } from '@/components/ai/PolishTrigger';
import { usePolishField } from '@/components/ai/usePolishField';
import { Button } from '@/components/ui/Button';
import { IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { ImportPanel } from '@/components/wizard/ImportPanel';
import type { ImportCandidateProps } from '@/components/wizard/ImportPanel';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { PolishContext } from '@/lib/schema/api';
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

interface PriorityRowProps {
  priority: Priority;
  index: number;
  updatePriority: <F extends keyof Priority>(id: string, field: F, value: Priority[F]) => void;
  removePriority: (id: string) => void;
  context: PolishContext;
}

/**
 * Row-alignment fix (Nav IA polish-affordance pass): mirrors `TaskRow`/
 * `RiskRow` -- one component instance per priority, each owning its own
 * `usePolishField` call (rules-of-hooks requires this once the hook is
 * called per-row rather than once per step; see TaskRow's own doc comment).
 */
function PriorityRow({ priority: p, index: i, updatePriority, removePriority, context }: PriorityRowProps) {
  const polish = usePolishField({
    field: 'priority',
    value: p.text,
    context,
    onAccept: (next) => updatePriority(p.id, 'text', next),
  });

  return (
    <div className={styles.priorityRow}>
      <div className={styles.fieldWithPolish}>
        <Input
          label={`Priority ${i + 1}`}
          value={p.text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updatePriority(p.id, 'text', e.target.value)}
        />
        <PolishTrigger state={polish} />
      </div>
      <Button variant="danger" size="sm" icon={<IconTrash />} onClick={() => removePriority(p.id)}>
        Remove
      </Button>
      <PolishPanel state={polish} />
    </div>
  );
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
  const context = { kind: draft.kind, period: draftPeriodLabel(draft) };
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
          <PriorityRow
            key={p.id}
            priority={p}
            index={i}
            updatePriority={updatePriority}
            removePriority={removePriority}
            context={context}
          />
        ))}
      </div>
      <Button variant="accent" size="sm" icon={<IconPlus />} onClick={addPriority}>
        Add Priority
      </Button>
    </div>
  );
}
