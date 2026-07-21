'use client';

import type { ChangeEvent } from 'react';
import { PolishButton } from '@/components/ai/PolishButton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { Draft } from '@/lib/types';
import styles from './Step.module.css';

export interface StepBasicsProps {
  draft: Draft;
  setDraftField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  /** Weekly wizard only: how many daily reports fall inside the draft's current week. Undefined for the daily wizard (hides the import panel entirely). */
  weekDailyCount?: number;
  /** Weekly wizard only: whether the current week has already been imported this session -- disables the button (a re-import would double-count touchpoints, see useWizard). */
  weekDailiesImported?: boolean;
  /** Weekly wizard only: aggregates this week's daily reports into the draft. */
  onImportWeekDailies?: () => void;
}

/**
 * Ported from design-source lines 119-136. Phase 4: branches on
 * `draft.kind` -- a daily draft gets a single "Date" field; a weekly draft
 * keeps the original Week Start/Week End pair, plus (when
 * `onImportWeekDailies` is supplied by the weekly wizard) an "Import This
 * Week's Daily Reports" panel.
 */
export function StepBasics({
  draft,
  setDraftField,
  weekDailyCount = 0,
  weekDailiesImported = false,
  onImportWeekDailies,
}: StepBasicsProps) {
  return (
    <div>
      <div className={styles.title}>Basics</div>

      {draft.kind === 'daily' ? (
        <div className={styles.grid2}>
          <Input
            type="date"
            label="Date"
            value={draft.date}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('date', e.target.value)}
          />
        </div>
      ) : (
        <>
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

          {onImportWeekDailies ? (
            <div className={styles.dailyImportPanel}>
              <div className={styles.kicker}>Import This Week&apos;s Daily Reports ({weekDailyCount} found)</div>
              <p className={styles.dailyImportCopy}>
                Aggregates every daily report inside this draft&apos;s week into it: tasks and risks dedupe by client
                (keeping each one&apos;s latest status), touchpoints are summed, and the win carries over only if this
                draft doesn&apos;t already have one. One-shot per week -- importing again won&apos;t double-count.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={weekDailyCount === 0 || weekDailiesImported}
                onClick={onImportWeekDailies}
              >
                {weekDailiesImported ? 'Imported' : 'Import Daily Reports'}
              </Button>
            </div>
          ) : null}
        </>
      )}

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
      <PolishButton
        field="summary"
        value={draft.summaryNarrative}
        context={{ kind: draft.kind, period: draftPeriodLabel(draft) }}
        onAccept={(next) => setDraftField('summaryNarrative', next)}
      />
      <div className={styles.preview}>{draftPeriodLabel(draft)}</div>
    </div>
  );
}
