import type { ReactNode } from 'react';
import styles from './WizardStepper.module.css';

const STEP_LABELS = ['Basics', 'Task Status', 'Touchpoints & Win', 'Risks & Blockers', 'Priorities', 'Review & Export'];

export interface WizardStepperProps {
  step: number;
  onStepClick: (n: number) => void;
}

/** Ported from design-source lines 84-114 (template) and 713-717 (styles). */
export function WizardStepper({ step, onStepClick }: WizardStepperProps) {
  const stepReached = (n: number) => step >= n;
  const elements: ReactNode[] = [];

  STEP_LABELS.forEach((label, i) => {
    const n = i + 1;
    const reached = stepReached(n);
    elements.push(
      <div key={`step-${n}`} className={styles.item} onClick={() => onStepClick(n)}>
        <div className={`${styles.circle} ${reached ? styles.circleReached : ''}`}>{n}</div>
        <span className={`${styles.label} ${step === n ? styles.labelActive : ''}`}>{label}</span>
      </div>
    );
    if (n < 6) {
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
