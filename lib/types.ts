// Domain types for the Weekly Reports Dashboard.
// Mirrors the shapes produced by design-source/original-dashboard.dc.html's
// ffSeedReports() / ffBlankDraft() (script block, lines 415-506).

export type ReportStatus = 'Draft' | 'Final' | 'Sent';

export type TaskStatus = 'Complete' | 'In Progress' | 'Blocked';

export type RiskSeverity = 'Blocked' | 'At Risk';

/**
 * Badge visual tone. NOTE: 'green' is intentionally included here even though
 * the Badge component has no distinct rendering for it. The prototype's
 * ffStatusTone() (design-source line 441) returns 'green' for Final-status
 * reports, but ffBadgeStyle() (line 430-440) has no 'green' entry in its tone
 * map -- so "Final" badges silently fall back to the 'neutral' style. This is
 * a faithful port of that prototype quirk; do not "fix" it silently.
 */
export type BadgeTone = 'positive' | 'negative' | 'warning' | 'sage' | 'dark' | 'neutral' | 'green';

export type SortKey = 'week_desc' | 'week_asc' | 'status' | 'blockers_desc';

export interface Task {
  id: string;
  client: string;
  task: string;
  status: TaskStatus;
  deadline: string;
}

export interface Risk {
  id: string;
  client: string;
  severity: RiskSeverity;
  description: string;
  nextStep: string;
}

export interface Priority {
  id: string;
  text: string;
}

export interface Win {
  stat: string;
  label: string;
  narrative: string;
}

export interface Touchpoints {
  calls: number;
  emails: number;
  escalations: number;
  narrative: string;
}

export interface Report {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: ReportStatus;
  preparedFor: string;
  preparedBy: string;
  createdAt: string;
  updatedAt: string;
  summaryNarrative: string;
  tasks: Task[];
  risks: Risk[];
  win: Win;
  touchpoints: Touchpoints;
  priorities: Priority[];
}

/**
 * Shape of an in-progress (not-yet-saved) report, as produced by
 * blankDraft() / resumeDraft() in the prototype. `id` is null until the
 * first save. Consumed by the wizard (Pass 2).
 */
export interface Draft {
  id: string | null;
  weekStart: string;
  weekEnd: string;
  preparedFor: string;
  preparedBy: string;
  summaryNarrative: string;
  status: ReportStatus;
  tasks: Task[];
  touchpoints: Touchpoints;
  win: Win;
  risks: Risk[];
  priorities: Priority[];
  createdAt?: string;
  updatedAt?: string;
}
