'use client';

import type { ChangeEvent } from 'react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { fmtWeekLabel } from '@/lib/format';
import type { Draft } from '@/lib/types';
import styles from './Step.module.css';

export interface StepBasicsProps {
  draft: Draft;
  setDraftField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
}

/** Ported from design-source lines 119-136. */
export function StepBasics({ draft, setDraftField }: StepBasicsProps) {
  return (
    <div>
      <div className={styles.title}>Basics</div>
      <div className={styles.grid2}>
        <Input
          type="date"
          label="Week Start"
          value={draft.weekStart}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('weekStart', e.target.value)}
        />
        <Input
          type="date"
          label="Week End"
          value={draft.weekEnd}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('weekEnd', e.target.value)}
        />
      </div>
      <div className={styles.grid2}>
        <Input
          label="Prepared For"
          placeholder="Christene, Founder"
          value={draft.preparedFor}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('preparedFor', e.target.value)}
        />
        <Input
          label="Prepared By"
          placeholder="Jordan Reyes, Project Manager"
          value={draft.preparedBy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('preparedBy', e.target.value)}
        />
      </div>
      <Textarea
        label="Executive Summary"
        placeholder="How did the week go, overall?"
        value={draft.summaryNarrative}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraftField('summaryNarrative', e.target.value)}
      />
      <div className={styles.preview}>{fmtWeekLabel(draft.weekStart, draft.weekEnd)}</div>
    </div>
  );
}
