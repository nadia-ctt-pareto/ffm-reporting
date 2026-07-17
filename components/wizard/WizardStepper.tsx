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
    elements.push(
      <div key={`step-${n}`} className={styles.item} onClick={() => onStepClick(n)}>
        <div
          className={styles.circle}
          style={{
            background: stepReached(n) ? '#283625' : '#FFFFFF',
            color: stepReached(n) ? '#FFFFFF' : '#6B6B66',
            border: stepReached(n) ? '2px solid #283625' : '2px solid #E4E4DE',
          }}
        >
          {n}
        </div>
        <span className={styles.label} style={{ color: step === n ? '#0A0A0A' : '#6B6B66' }}>
          {label}
        </span>
      </div>
    );
    if (n < 6) {
      elements.push(
        <div
          key={`divider-${n}`}
          className={styles.divider}
          style={{ background: stepReached(n + 1) ? '#283625' : '#E4E4DE' }}
        />
      );
    }
  });

  return <div className={styles.row}>{elements}</div>;
}
