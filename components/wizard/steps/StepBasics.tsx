'use client';

import type { ChangeEvent } from 'react';
import { PolishPanel } from '@/components/ai/PolishPanel';
import { PolishTrigger } from '@/components/ai/PolishTrigger';
import { usePolishField } from '@/components/ai/usePolishField';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { draftPeriodLabel } from '@/lib/report-utils';
import { preparedBySelectOptions, preparedBySelectValue, preparedForSelectOptions, resolvePreparedByValue } from '@/lib/team';
import type { Draft, TeamMember } from '@/lib/types';
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
  /**
   * WP7 (Prepared By/For directory pickers): the team directory backing
   * both fields below. `null` while `useTeamMembers()` is still loading --
   * both fields fall back to their pre-existing free-text `<Input>` until
   * this resolves, rather than flash a dropdown with zero (or the wrong)
   * options for a moment. `[]` (a genuinely empty directory, no org has
   * added anyone yet) degrades to the exact same fallback, permanently --
   * "a wizard you cannot complete is worse than a free-text field" (this
   * package's own governing plan).
   */
  teamMembers: TeamMember[] | null;
  /**
   * WP7 (Prepared By/For directory pickers): non-null when the signed-in
   * caller resolves to a plain (non-pm/admin) team member -- see
   * `lib/team.ts`'s `resolvePreparedByAutoFill`. When set, Prepared By
   * renders as a locked, read-only field showing this name (with a short
   * hint) instead of a dropdown -- `useWizard.ts`'s own effect is what
   * actually stamps this name onto `draft.preparedBy`; this prop only
   * decides how the field RENDERS here. `null`/`undefined` (a pm/admin, an
   * unresolved user, or demo mode -- no session concept at all) all get the
   * ordinary directory dropdown instead.
   */
  preparedByAutoFillName?: string | null;
}

/**
 * Ported from design-source lines 119-136. Phase 4: branches on
 * `draft.kind` -- a daily draft gets a single "Date" field; a weekly draft
 * keeps the original Week Start/Week End pair, plus (when
 * `onImportWeekDailies` is supplied by the weekly wizard) an "Import This
 * Week's Daily Reports" panel.
 *
 * WP7 (Prepared By/For directory pickers): Prepared For and Prepared By
 * source their options from the team directory (`teamMembers`) instead of
 * being plain free-text fields -- see `lib/team.ts`'s header comment on the
 * two option-builders (`preparedForSelectOptions`/`preparedBySelectOptions`)
 * for the locked "plain STRING, not a foreign key" design decision and the
 * legacy-value-preservation rule that makes it safe to swap a proven
 * free-text field for a `<Select>` without risking silent data loss on a
 * field that's printed on the deck cover. Both fields degrade to their
 * original `<Input>` while the directory is still loading or genuinely empty
 * (`teamMembers === null || teamMembers.length === 0`) -- see this
 * component's own `teamMembers` prop doc comment. Prepared By additionally
 * renders LOCKED and read-only (no dropdown at all) for a plain member --
 * see `preparedByAutoFillName`'s own doc comment; `useWizard.ts`'s effect is
 * what keeps the underlying draft value in sync with that lock.
 */
export function StepBasics({
  draft,
  setDraftField,
  weekDailyCount = 0,
  weekDailiesImported = false,
  onImportWeekDailies,
  teamMembers,
  preparedByAutoFillName,
}: StepBasicsProps) {
  // WP7: `members` is always a real (possibly empty) array -- a plain `?? []`
  // coalesce, kept separate from `directoryReady` below purely so the two
  // `preparedXSelectOptions` calls further down don't need a redundant
  // `teamMembers !== null` narrowing check of their own (TypeScript doesn't
  // propagate narrowing through an intermediate boolean like `directoryReady`
  // the way it would through a direct `teamMembers !== null` check inline).
  // `directoryReady` is the ONE gate both fields below branch on -- `null`
  // (still loading) and `[]` (genuinely empty) are deliberately collapsed
  // into the SAME fallback (see the `teamMembers` prop doc comment), so
  // there's exactly one condition to keep in sync rather than two that could
  // silently drift.
  const members = teamMembers ?? [];
  const directoryReady = teamMembers !== null && members.length > 0;
  const summaryPolish = usePolishField({
    field: 'summary',
    value: draft.summaryNarrative,
    context: { kind: draft.kind, period: draftPeriodLabel(draft) },
    onAccept: (next) => setDraftField('summaryNarrative', next),
  });

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
        {directoryReady ? (
          <Select
            label="Prepared For"
            options={preparedForSelectOptions(members, draft.preparedFor)}
            value={draft.preparedFor}
            onChange={(value) => setDraftField('preparedFor', value)}
          />
        ) : (
          <Input
            label="Prepared For"
            placeholder="Christene, Founder"
            value={draft.preparedFor}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('preparedFor', e.target.value)}
          />
        )}

        {preparedByAutoFillName ? (
          <div>
            <Input label="Prepared By" value={preparedByAutoFillName} readOnly />
            <p className={styles.fieldHint}>You can only prepare your own reports, so this is locked to your name.</p>
          </div>
        ) : directoryReady ? (
          <Select
            label="Prepared By"
            options={preparedBySelectOptions(members, draft.preparedBy)}
            value={preparedBySelectValue(draft.preparedBy)}
            onChange={(value) => setDraftField('preparedBy', resolvePreparedByValue(value))}
          />
        ) : (
          <Input
            label="Prepared By"
            placeholder="Jordan Reyes, Project Manager"
            value={draft.preparedBy}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftField('preparedBy', e.target.value)}
          />
        )}
      </div>
      <div className={styles.textareaField}>
        <Textarea
          label="Executive Summary"
          placeholder="How did the week go, overall?"
          value={draft.summaryNarrative}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraftField('summaryNarrative', e.target.value)}
        />
        <PolishTrigger state={summaryPolish} anchor="textarea" />
      </div>
      <PolishPanel state={summaryPolish} />
      <div className={styles.preview}>{draftPeriodLabel(draft)}</div>
    </div>
  );
}
