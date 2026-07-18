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
import { fmtWeekLabel } from '@/lib/format';
import type { Report } from '@/lib/types';
import styles from './WizardScreen.module.css';

export interface WizardScreenProps {
  reports: Report[];
  initialReport: Report | null;
  onExit: () => void;
  onSaveDraft: (report: Report) => void;
  onPublish: (report: Report) => void;
  onShareForPublished: (reportId: string) => void;
  onPdfForPublished: (reportId: string) => void;
}

/**
 * The 6-step wizard shell. Ported from design-source lines 71-338 (template)
 * and 508-792 (behavior, via useWizard). Mount this with a `key` that
 * changes whenever `initialReport` changes (see WeeklyReportsApp) so a
 * fresh "New Report" or "Continue" never shows a stale draft.
 */
export function WizardScreen({
  reports,
  initialReport,
  onExit,
  onSaveDraft,
  onPublish,
  onShareForPublished,
  onPdfForPublished,
}: WizardScreenProps) {
  const wizard = useWizard(reports, initialReport, { onSaveDraft, onPublish });
  const { draft, step, error, published } = wizard;

  const stepPanel = (() => {
    switch (step) {
      case 1:
        return <StepBasics draft={draft} setDraftField={wizard.setDraftField} />;
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
        <span className={styles.wordmark}>{draft.id ? 'Editing Draft' : 'New Weekly Report'}</span>
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
                {fmtWeekLabel(draft.weekStart, draft.weekEnd)} is now in the historical record. Export it below, or
                head back to the dashboard.
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
