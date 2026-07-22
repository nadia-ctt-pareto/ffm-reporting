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
import { RISK_SEVERITY_OPTIONS } from '@/lib/constants';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { Draft, Risk } from '@/lib/types';
import styles from './Step.module.css';

export interface StepRisksProps {
  draft: Draft;
  updateRisk: <F extends keyof Risk>(id: string, field: F, value: Risk[F]) => void;
  removeRisk: (id: string) => void;
  addRisk: () => void;
  /** Phase 6a: known project names, offered as native datalist autocomplete on the Client field. */
  clientSuggestions?: string[];
  sourceOptions: { value: string; label: string }[];
  importRiskSource: string;
  onImportRiskSourceChange: (value: string) => void;
  importRiskCandidates: ImportCandidateProps[];
  importRiskDisabled: boolean;
  importSelectedRisks: () => void;
}

interface RiskRowProps {
  risk: Risk;
  updateRisk: <F extends keyof Risk>(id: string, field: F, value: Risk[F]) => void;
  removeRisk: (id: string) => void;
  clientSuggestions?: string[];
  kind: Draft['kind'];
  period: string;
}

/**
 * Row-alignment fix (Nav IA polish-affordance pass): mirrors `TaskRow`
 * (StepTasks.tsx) -- one component instance per risk, each owning its OWN
 * two `usePolishField` calls (Description, Next Step), which is what makes
 * calling that hook legal here at all (see TaskRow's own doc comment for
 * why). Both PolishPanels render as this row's own grid siblings (after
 * the Remove button), spanning the full row width instead of just their
 * own column.
 */
function RiskRow({ risk: rk, updateRisk, removeRisk, clientSuggestions, kind, period }: RiskRowProps) {
  const descriptionPolish = usePolishField({
    field: 'riskDescription',
    value: rk.description,
    context: { kind, period, client: rk.client, severity: rk.severity },
    onAccept: (next) => updateRisk(rk.id, 'description', next),
  });
  const nextStepPolish = usePolishField({
    field: 'riskNextStep',
    value: rk.nextStep,
    context: { kind, period, client: rk.client, severity: rk.severity },
    onAccept: (next) => updateRisk(rk.id, 'nextStep', next),
  });

  return (
    <div className={styles.riskRow}>
      <Input
        label="Client"
        value={rk.client}
        onChange={(e: ChangeEvent<HTMLInputElement>) => updateRisk(rk.id, 'client', e.target.value)}
        suggestions={clientSuggestions}
      />
      <Select
        label="Severity"
        options={[...RISK_SEVERITY_OPTIONS]}
        value={rk.severity}
        onChange={(value) => updateRisk(rk.id, 'severity', value as Risk['severity'])}
      />
      <div className={styles.fieldWithPolish}>
        <Input
          label="Description"
          value={rk.description}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateRisk(rk.id, 'description', e.target.value)}
        />
        <PolishTrigger state={descriptionPolish} />
      </div>
      <div className={styles.fieldWithPolish}>
        <Input
          label="Next Step"
          value={rk.nextStep}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateRisk(rk.id, 'nextStep', e.target.value)}
        />
        <PolishTrigger state={nextStepPolish} />
      </div>
      <Button variant="danger" size="sm" icon={<IconTrash />} onClick={() => removeRisk(rk.id)}>
        Remove
      </Button>
      <PolishPanel state={descriptionPolish} />
      <PolishPanel state={nextStepPolish} />
    </div>
  );
}

/** Ported from design-source lines 199-232. */
export function StepRisks({
  draft,
  updateRisk,
  removeRisk,
  addRisk,
  clientSuggestions,
  sourceOptions,
  importRiskSource,
  onImportRiskSourceChange,
  importRiskCandidates,
  importRiskDisabled,
  importSelectedRisks,
}: StepRisksProps) {
  const period = draftPeriodLabel(draft);
  return (
    <div>
      <div className={styles.title}>{'Risks & Blockers'}</div>

      <ImportPanel
        kicker="Import Open Risks From a Prior Report"
        emptyMessage="No open risks from that report to import."
        sourceOptions={sourceOptions}
        sourceId={importRiskSource}
        onSourceChange={onImportRiskSourceChange}
        candidates={importRiskCandidates}
        onImport={importSelectedRisks}
        disabled={importRiskDisabled}
      />

      <div className={styles.rowsList}>
        {draft.risks.map((rk) => (
          <RiskRow
            key={rk.id}
            risk={rk}
            updateRisk={updateRisk}
            removeRisk={removeRisk}
            clientSuggestions={clientSuggestions}
            kind={draft.kind}
            period={period}
          />
        ))}
      </div>
      <Button variant="accent" size="sm" icon={<IconPlus />} onClick={addRisk}>
        Add Risk
      </Button>
    </div>
  );
}
