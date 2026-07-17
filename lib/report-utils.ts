// Ported verbatim from design-source/original-dashboard.dc.html script block:
// ffOnSchedule/ffOpenBlockers (428-429), tone mappers (441-443),
// ffBlankDraft (445-448), validateStep (530-536).

import type { BadgeTone, Draft, Report, RiskSeverity, TaskStatus } from './types';

/** Line 428 */
export function onSchedule(report: Pick<Report, 'tasks'>): { onSched: number; total: number } {
  const total = report.tasks.length;
  const onSched = report.tasks.filter((t) => t.status !== 'Blocked').length;
  return { onSched, total };
}

/** Line 429 */
export function openBlockers(report: Pick<Report, 'tasks'>): number {
  return report.tasks.filter((t) => t.status === 'Blocked').length;
}

/**
 * Line 441. NOTE: returns 'green' for 'Final' -- there is no 'green' tone in
 * Badge's style map, so "Final" badges render as 'neutral'. Faithful port of
 * a prototype quirk; see the BadgeTone comment in lib/types.ts.
 */
export function statusTone(status: Report['status']): BadgeTone {
  return status === 'Sent' ? 'dark' : status === 'Final' ? 'green' : 'sage';
}

/** Line 442 */
export function taskTone(status: TaskStatus): BadgeTone {
  return status === 'Complete' ? 'positive' : status === 'Blocked' ? 'negative' : 'sage';
}

/** Line 443 */
export function riskTone(severity: RiskSeverity): BadgeTone {
  return severity === 'Blocked' ? 'negative' : 'warning';
}

/** Lines 445-448 */
export function blankDraft(): Draft {
  return {
    id: null,
    weekStart: '',
    weekEnd: '',
    preparedFor: 'Christene, Founder',
    preparedBy: 'Jordan Reyes, Project Manager',
    summaryNarrative: '',
    status: 'Draft',
    tasks: [],
    touchpoints: { calls: 0, emails: 0, escalations: 0, narrative: '' },
    win: { stat: '', label: '', narrative: '' },
    risks: [],
    priorities: [],
  };
}

/**
 * Lines 530-536. Used by the wizard (Pass 2); defined now so the contract
 * exists for both passes.
 */
export function validateStep(step: number, draft: Draft): string {
  if (step === 1) {
    if (!draft.weekStart || !draft.weekEnd) return 'Enter the week start and end dates.';
    if (!draft.preparedFor.trim()) return 'Enter who this report is prepared for.';
  }
  if (step === 2) {
    if (draft.tasks.length === 0) return 'Add at least one task before continuing.';
  }
  if (step === 5) {
    if (draft.priorities.length === 0) return "Add at least one priority for next week.";
  }
  return '';
}
