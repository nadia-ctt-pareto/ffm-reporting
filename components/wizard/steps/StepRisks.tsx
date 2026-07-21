'use client';

import type { ChangeEvent } from 'react';
import { PolishButton } from '@/components/ai/PolishButton';
import { Button } from '@/components/ui/Button';
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
          <div key={rk.id} className={styles.riskRow}>
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
              <PolishButton
                field="riskDescription"
                value={rk.description}
                context={{ kind: draft.kind, period, client: rk.client, severity: rk.severity }}
                onAccept={(next) => updateRisk(rk.id, 'description', next)}
              />
            </div>
            <div className={styles.fieldWithPolish}>
              <Input
                label="Next Step"
                value={rk.nextStep}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateRisk(rk.id, 'nextStep', e.target.value)}
              />
              <PolishButton
                field="riskNextStep"
                value={rk.nextStep}
                context={{ kind: draft.kind, period, client: rk.client, severity: rk.severity }}
                onAccept={(next) => updateRisk(rk.id, 'nextStep', next)}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => removeRisk(rk.id)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addRisk}>
        Add Risk
      </Button>
    </div>
  );
}
