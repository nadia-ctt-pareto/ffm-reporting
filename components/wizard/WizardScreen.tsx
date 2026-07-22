'use client';

import { Button } from '@/components/ui/Button';
import { StepBasics } from '@/components/wizard/steps/StepBasics';
import { StepPriorities } from '@/components/wizard/steps/StepPriorities';
import { StepReview } from '@/components/wizard/steps/StepReview';
import { StepRisks } from '@/components/wizard/steps/StepRisks';
import { StepTasks } from '@/components/wizard/steps/StepTasks';
import { StepTouchpointsWin } from '@/components/wizard/steps/StepTouchpointsWin';
import { useWizard } from '@/components/wizard/useWizard';
import { WizardStepper } from '@/components/wizard/WizardStepper';
import { draftPeriodLabel } from '@/lib/report-utils';
import type { AnyReport, DailyReport, Project, ReportKind, TeamMember } from '@/lib/types';
import styles from './WizardScreen.module.css';

export interface WizardScreenProps {
  /** Which kind of report this wizard mount drafts. Decides the blank-draft shape, step-1's fields, and header/confirmation copy. */
  kind: ReportKind;
  /** Same-kind prior reports (weeklies for the weekly wizard, dailies for the daily wizard) -- feeds the carry-forward Import panels (steps 2/4/5). */
  reports: AnyReport[];
  /** Weekly wizard only: ALL daily reports, for the "Import This Week's Daily Reports" panel on step 1. Omit for the daily wizard. */
  dailies?: DailyReport[];
  /** Phase 6a: all known projects -- client-field datalist suggestions (StepTasks/StepRisks) and the client -> projectId stamp (see useWizard). */
  projects?: Project[];
  /** WP2: the team directory -- StepTasks' Assignee `<Select>`. */
  teamMembers?: TeamMember[];
  initialReport: AnyReport | null;
  onExit: () => void;
  /** Phase 7b: `Promise<void>` -- see `useWizard`'s `UseWizardOptions.onSaveDraft` doc comment (`saveDraft()` awaits this and surfaces a rejection through the wizard's `error` channel). */
  onSaveDraft: (report: AnyReport) => Promise<void>;
  /** Phase 7b: `Promise<void>` -- see `useWizard`'s `UseWizardOptions.onPublish` doc comment (`publish()` only shows the confirmation screen after this resolves). */
  onPublish: (report: AnyReport) => Promise<void>;
  onShareForPublished: (reportId: string) => void;
  onPdfForPublished: (reportId: string) => void;
}

/**
 * The 6-step wizard shell. Ported from design-source lines 71-338 (template)
 * and 508-792 (behavior, via useWizard). Mount this with a `key` that
 * changes whenever `initialReport` changes (see WizardPage) so a fresh "New
 * Report" or "Continue" never shows a stale draft.
 *
 * Phase 4: shared verbatim by both the weekly and daily wizards -- `kind`
 * only changes step 1 (StepBasics) and this file's own header/confirmation
 * copy; steps 2-6 are completely kind-agnostic.
 *
 * Phase 6a: `projects` (optional) feeds `clientSuggestions` (project names)
 * down into StepTasks/StepRisks' Client fields as native `<datalist>`
 * autocomplete, and into `useWizard` so a client edit can stamp the
 * matching `projectId`. No project creation happens from the wizard.
 *
 * WP2: `teamMembers` (optional) passes straight through to StepTasks' Assignee
 * `<Select>` -- no `useWizard` involvement needed (`updateTask`'s existing
 * generic field-update path already handles `assigneeId`, the same way it
 * handles every field besides the two that get special status/client
 * handling).
 */
export function WizardScreen({
  kind,
  reports,
  dailies,
  projects,
  teamMembers,
  initialReport,
  onExit,
  onSaveDraft,
  onPublish,
  onShareForPublished,
  onPdfForPublished,
}: WizardScreenProps) {
  const wizard = useWizard(reports, initialReport, { kind, onSaveDraft, onPublish, dailies, projects });
  const { draft, step, error, published, wasPublished, isSubmitting } = wizard;
  const kindLabel = kind === 'daily' ? 'Daily' : 'Weekly';
  const clientSuggestions = (projects ?? []).map((p) => p.name);
  // Phase 8d (editing a published report): resume-aware copy for a report that was already published
  // (`'Final'`/`'Sent'`) when this wizard mount opened -- see `wasPublished`'s
  // own doc comment (components/wizard/useWizard.ts) for why this is derived
  // once at mount rather than from the live, editable `draft.status`.
  const publishLabel = wasPublished ? 'Update Report' : 'Publish Report';

  const stepPanel = (() => {
    switch (step) {
      case 1:
        return (
          <StepBasics
            draft={draft}
            setDraftField={wizard.setDraftField}
            weekDailyCount={kind === 'weekly' ? wizard.weekDailyCount : undefined}
            weekDailiesImported={kind === 'weekly' ? wizard.weekDailiesImported : undefined}
            onImportWeekDailies={kind === 'weekly' ? wizard.importWeekDailies : undefined}
          />
        );
      case 2:
        return (
          <StepTasks
            draft={draft}
            updateTask={wizard.updateTask}
            removeTask={wizard.removeTask}
            addTask={wizard.addTask}
            clientSuggestions={clientSuggestions}
            teamMembers={teamMembers ?? []}
            sourceOptions={wizard.priorReportOptions}
            importTaskSource={wizard.importTaskSource}
            onImportTaskSourceChange={wizard.onImportTaskSourceChange}
            importTaskCandidates={wizard.importTaskCandidates}
            importTaskDisabled={wizard.importTaskDisabled}
            importSelectedTasks={wizard.importSelectedTasks}
            carryForwardNote={wizard.carryForwardNote}
            onDismissCarryForward={wizard.dismissCarryForward}
            onUndoCarryForward={wizard.undoCarryForward}
          />
        );
      case 3:
        return (
          <StepTouchpointsWin draft={draft} setTouchpointsField={wizard.setTouchpointsField} setWinField={wizard.setWinField} />
        );
      case 4:
        return (
          <StepRisks
            draft={draft}
            updateRisk={wizard.updateRisk}
            removeRisk={wizard.removeRisk}
            addRisk={wizard.addRisk}
            clientSuggestions={clientSuggestions}
            sourceOptions={wizard.priorReportOptions}
            importRiskSource={wizard.importRiskSource}
            onImportRiskSourceChange={wizard.onImportRiskSourceChange}
            importRiskCandidates={wizard.importRiskCandidates}
            importRiskDisabled={wizard.importRiskDisabled}
            importSelectedRisks={wizard.importSelectedRisks}
          />
        );
      case 5:
        return (
          <StepPriorities
            draft={draft}
            updatePriority={wizard.updatePriority}
            removePriority={wizard.removePriority}
            addPriority={wizard.addPriority}
            sourceOptions={wizard.priorReportOptions}
            importPrioritySource={wizard.importPrioritySource}
            onImportPrioritySourceChange={wizard.onImportPrioritySourceChange}
            importPriorityCandidates={wizard.importPriorityCandidates}
            importPriorityDisabled={wizard.importPriorityDisabled}
            importSelectedPriorities={wizard.importSelectedPriorities}
          />
        );
      case 6:
      default:
        return (
          <StepReview draft={draft} onPublish={wizard.publish} isSubmitting={isSubmitting} publishLabel={publishLabel} />
        );
    }
  })();

  return (
    <div>
      {/*
       * Line 73-82: header is unconditional (Save Draft/Save Changes and
       * Exit stay live even on the published-confirmation screen).
       *
       * Phase 8d (editing a published report): this header's wordmark/save-button copy is resume-aware --
       * `wasPublished` (captured once at mount, see useWizard.ts's doc
       * comment) distinguishes "still drafting" from "correcting an
       * already-published report" for a resumed report; a brand-new draft
       * always shows the original "New {kind} Report" wordmark and "Save
       * Draft" button regardless. This SUPERSEDES the old "saveDraft always
       * forces Draft status" faithful-port quirk noted here previously (see
       * CLAUDE.md's "Known faithful-port quirks" bullet and this package's
       * `useWizard.ts` changes) -- the same way the two dark-mode quirks
       * were superseded in Phase 1, not silently "fixed" without a trace.
       */}
      <div className={styles.header}>
        <span className={styles.wordmark}>
          {draft.id ? (wasPublished ? 'Editing Report' : 'Editing Draft') : `New ${kindLabel} Report`}
        </span>
        <div className={styles.headerActions}>
          <div className={styles.headerButtons}>
            <Button variant="ghost" size="sm" onClick={wizard.saveDraft} disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : wasPublished ? 'Save Changes' : 'Save Draft'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onExit}>
              Exit
            </Button>
          </div>
        </div>
      </div>

      {/* Lines 84-114: the stepper always renders, even on the published screen. */}
      <WizardStepper step={step} onStepClick={wizard.goToStep} />

      <div className={styles.body}>
        <div className={styles.panel}>
          {published ? (
            <div className={styles.publishedWrap}>
              {/* Phase 8d (editing a published report): resume-aware confirmation copy -- correcting an
                  already-published report reads as "Report Updated", not a
                  re-announcement of a first-time "Report Published". */}
              <div className={styles.publishedTitle}>{wasPublished ? 'Report Updated' : 'Report Published'}</div>
              <p className={styles.publishedCopy}>
                {wasPublished
                  ? `${draftPeriodLabel(draft)} has been updated in the historical record. Export it below, or head back to your reports.`
                  : `${draftPeriodLabel(draft)} is now in the historical record. Export it below, or head back to your reports.`}
              </p>
              <div className={styles.publishedButtons}>
                <Button variant="outline" size="md" onClick={() => draft.id && onShareForPublished(draft.id)}>
                  Copy Share Link
                </Button>
                <Button variant="outline" size="md" onClick={() => draft.id && onPdfForPublished(draft.id)}>
                  Download PDF
                </Button>
              </div>
              <Button variant="dark" size="md" onClick={onExit}>
                Back to {kindLabel} Reports
              </Button>
            </div>
          ) : (
            <>
              {stepPanel}

              {error ? <div className={styles.error}>{error}</div> : null}

              {step < 6 ? (
                <div className={styles.nav}>
                  <Button variant="outline" size="md" disabled={step === 1} onClick={wizard.back}>
                    Back
                  </Button>
                  <Button variant="dark" size="md" onClick={wizard.next}>
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
