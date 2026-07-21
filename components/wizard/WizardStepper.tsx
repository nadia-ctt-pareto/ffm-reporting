import type { ReactNode } from 'react';
import styles from './WizardStepper.module.css';

/** The report wizard's six steps (design-source lines 84-114). The default so
    every existing `<WizardStepper step ... />` call site is unchanged. */
const DEFAULT_STEP_LABELS = ['Basics', 'Task Status', 'Touchpoints & Win', 'Risks & Blockers', 'Priorities', 'Review & Export'];

export interface WizardStepperProps {
  step: number;
  onStepClick: (n: number) => void;
  /** Nav IA restructure: the Consolidate wizard reuses this stepper with its own
      4 labels. Count and the divider cutoff derive from this array's length, so
      an N-step flow just passes N labels. Defaults to the report wizard's six. */
  labels?: string[];
}

/** Ported from design-source lines 84-114 (template) and 713-717 (styles). */
export function WizardStepper({ step, onStepClick, labels = DEFAULT_STEP_LABELS }: WizardStepperProps) {
  const stepReached = (n: number) => step >= n;
  const elements: ReactNode[] = [];

  labels.forEach((label, i) => {
    const n = i + 1;
    const reached = stepReached(n);
    elements.push(
      <div key={`step-${n}`} className={styles.item} onClick={() => onStepClick(n)}>
        <div className={`${styles.circle} ${reached ? styles.circleReached : ''}`}>{n}</div>
        <span className={`${styles.label} ${step === n ? styles.labelActive : ''}`}>{label}</span>
      </div>
    );
    if (n < labels.length) {
      elements.push(
        <div
          key={`divider-${n}`}
          className={`${styles.divider} ${stepReached(n + 1) ? styles.dividerReached : ''}`}
        />
      );
    }
  });

  return <div className={styles.row}>{elements}</div>;
}
