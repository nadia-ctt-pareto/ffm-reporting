'use client';

import type { ChangeEvent } from 'react';
import { PolishButton } from '@/components/ai/PolishButton';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { Draft } from '@/lib/types';
import styles from './Step.module.css';

export interface StepTouchpointsWinProps {
  draft: Draft;
  setTouchpointsField: <K extends keyof Draft['touchpoints']>(field: K, value: Draft['touchpoints'][K]) => void;
  setWinField: <K extends keyof Draft['win']>(field: K, value: Draft['win'][K]) => void;
}

/**
 * Post-review nit: `Number(e.target.value) || 0` accepted `2.5` and `-3` --
 * `TouchpointsSchema` (`lib/schema/report.ts`) is `int().nonnegative()`, so
 * Publishing a report with a fractional/negative touchpoint count used to
 * 400 at the wire, the same root cause as BLOCKER 2 (a client-side value
 * the server schema can't accept, discovered only at publish time). Clamped
 * at the input instead: truncate toward zero, then floor at 0.
 */
function nonNegativeInt(raw: string): number {
  return Math.max(0, Math.trunc(Number(raw) || 0));
}

/** Ported from design-source lines 173-197. */
export function StepTouchpointsWin({ draft, setTouchpointsField, setWinField }: StepTouchpointsWinProps) {
  const context = { kind: draft.kind, period: draftPeriodLabel(draft) };
  return (
    <div>
      <div className={styles.title}>{"This Week's Touchpoints & Win"}</div>
      <div className={styles.grid3}>
        <Input
          type="number"
          label="Client Calls"
          value={draft.touchpoints.calls}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('calls', nonNegativeInt(e.target.value))}
        />
        <Input
          type="number"
          label="Email Threads"
          value={draft.touchpoints.emails}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('emails', nonNegativeInt(e.target.value))}
        />
        <Input
          type="number"
          label="Escalations"
          value={draft.touchpoints.escalations}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTouchpointsField('escalations', nonNegativeInt(e.target.value))}
        />
      </div>
      <div className={styles.textareaSpacer}>
        <Textarea
          label="Touchpoints Notes"
          placeholder="Anything noteworthy about client communication this week?"
          value={draft.touchpoints.narrative}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTouchpointsField('narrative', e.target.value)}
        />
        <PolishButton
          field="touchpointsNarrative"
          value={draft.touchpoints.narrative}
          context={context}
          onAccept={(next) => setTouchpointsField('narrative', next)}
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
        <PolishButton field="winNarrative" value={draft.win.narrative} context={context} onAccept={(next) => setWinField('narrative', next)} />
      </div>
    </div>
  );
}
