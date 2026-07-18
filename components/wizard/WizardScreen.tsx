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
import type { AnyReport, DailyReport, ReportKind } from '@/lib/types';
import styles from './WizardScreen.module.css';

export interface WizardScreenProps {
  /** Which kind of report this wizard mount drafts. Decides the blank-draft shape, step-1's fields, and header/confirmation copy. */
  kind: ReportKind;
  /** Same-kind prior reports (weeklies for the weekly wizard, dailies for the daily wizard) -- feeds the carry-forward Import panels (steps 2/4/5). */
  reports: AnyReport[];
  /** Weekly wizard only: ALL daily reports, for the "Import This Week's Daily Reports" panel on step 1. Omit for the daily wizard. */
  dailies?: DailyReport[];
  initialReport: AnyReport | null;
  onExit: () => void;
  onSaveDraft: (report: AnyReport) => void;
  onPublish: (report: AnyReport) => void;
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
 */
export function WizardScreen({
  kind,
  reports,
  dailies,
  initialReport,
  onExit,
  onSaveDraft,
  onPublish,
  onShareForPublished,
  onPdfForPublished,
}: WizardScreenProps) {
  const wizard = useWizard(reports, initialReport, { kind, onSaveDraft, onPublish, dailies });
  const { draft, step, error, published } = wizard;
  const kindLabel = kind === 'daily' ? 'Daily' : 'Weekly';

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
            sourceOptions={wizard.priorReportOptions}
            importTaskSource={wizard.importTaskSource}
            onImportTaskSourceChange={wizard.onImportTaskSourceChange}
            importTaskCandidates={wizard.importTaskCandidates}
            importTaskDisabled={wizard.importTaskDisabled}
            importSelectedTasks={wizard.importSelectedTasks}
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
        return <StepReview draft={draft} onPublish={wizard.publish} />;
    }
  })();

  return (
    <div>
      {/* Line 73-82: header is unconditional (Save Draft/Exit stay live even
          on the published-confirmation screen -- saveDraft always forces
          Draft status, a faithful-port quirk; see CLAUDE.md). */}
      <div className={styles.header}>
        <span className={styles.wordmark}>{draft.id ? 'Editing Draft' : `New ${kindLabel} Report`}</span>
        <div className={styles.headerActions}>
          <div className={styles.headerButtons}>
            <Button variant="ghost" size="sm" onClick={wizard.saveDraft}>
              Save Draft
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
              <div className={styles.publishedTitle}>Report Published</div>
              <p className={styles.publishedCopy}>
                {draftPeriodLabel(draft)} is now in the historical record. Export it below, or head back to the
                dashboard.
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
                Back to Dashboard
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
