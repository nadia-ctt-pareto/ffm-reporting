'use client';

import type { ChangeEvent } from 'react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { Draft } from '@/lib/types';
import styles from './Step.module.css';

export interface StepTouchpointsWinProps {
  draft: Draft;
  setTouchpointsField: <K extends keyof Draft['touchpoints']>(field: K, value: Draft['touchpoints'][K]) => void;
  setWinField: <K extends keyof Draft['win']>(field: K, value: Draft['win'][K]) => void;
}

/** Ported from design-source lines 173-197. */
export function StepTouchpointsWin({ draft, setTouchpointsField, setWinField }: StepTouchpointsWinProps) {
  return (
    <div>
      <div className={styles.title}>{"This Week's Touchpoints & Win"}</div>
      <div className={styles.grid3}>
        <Input
          type="number"
          label="Client Calls"
          value={draft.touchpoints.calls}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('calls', Number(e.target.value) || 0)}
        />
        <Input
          type="number"
          label="Email Threads"
          value={draft.touchpoints.emails}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('emails', Number(e.target.value) || 0)}
        />
        <Input
          type="number"
          label="Escalations"
          value={draft.touchpoints.escalations}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('escalations', Number(e.target.value) || 0)}
        />
      </div>
      <div className={styles.textareaSpacer}>
        <Textarea
          label="Touchpoints Notes"
          placeholder="Anything noteworthy about client communication this week?"
          value={draft.touchpoints.narrative}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTouchpointsField('narrative', e.target.value)}
        />
      </div>
      <div className={styles.divider}>
        <div className={styles.kicker}>{"This Week's Win"}</div>
        <div className={styles.grid1x2}>
          <Input
            label="Stat (e.g. 18%)"
            value={draft.win.stat}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWinField('stat', e.target.value)}
          />
          <Input
            label="What It Means"
            value={draft.win.label}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWinField('label', e.target.value)}
          />
        </div>
        <Textarea
          label="Win Narrative"
          placeholder="Tell the story behind the number."
          value={draft.win.narrative}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setWinField('narrative', e.target.value)}
        />
      </div>
    </div>
  );
}
