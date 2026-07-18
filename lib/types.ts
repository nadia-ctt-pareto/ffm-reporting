// Domain types for the Weekly Reports Dashboard.
// Mirrors the shapes produced by design-source/original-dashboard.dc.html's
// ffSeedReports() / ffBlankDraft() (script block, lines 415-506).
//
// Phase 4 (daily reports): the domain model became a discriminated union --
// `WeeklyReport` (one per week) and `DailyReport` (one per day, covering all
// clients) share every field except their period ("weekStart"/"weekEnd" vs.
// "date"). `Report` stays an alias for `WeeklyReport` so every Phase 1-3
// call site (dashboard, weekly wizard, CSV, report/deck/present, task &
// calendar views) keeps compiling unchanged -- `ReportsRepository.getAll()`
// still only ever returns weeklies (see lib/data/), which is what makes
// that alias sound everywhere it's used.

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

/** Phase 4: which shape of report a given row/draft is. */
export type ReportKind = 'weekly' | 'daily';

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

/**
 * Every field a weekly report and a daily report share. Exported (not just
 * a private helper interface) because `ReportsRepository.update()`'s patch
 * type is `Partial<ReportCore>` -- see lib/data/reports-repository.ts.
 */
export interface ReportCore {
  id: string;
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

export interface WeeklyReport extends ReportCore {
  kind: 'weekly';
  weekStart: string;
  weekEnd: string;
}

/** One per calendar day, covering all clients (not per-client). */
export interface DailyReport extends ReportCore {
  kind: 'daily';
  date: string;
}

export type AnyReport = WeeklyReport | DailyReport;

/**
 * Alias retained so every Phase 1-3 call site (dashboard, weekly wizard,
 * CSV, report screen/deck/present route, task/calendar views) keeps
 * compiling with near-zero churn post-Phase-4. Sound because
 * `ReportsRepository.getAll()` is contractually weeklies-only (see
 * lib/data/reports-repository.ts) -- everywhere `Report` is used, the value
 * really is a `WeeklyReport`.
 */
export type Report = WeeklyReport;

/**
 * Loose patch shape accepted by `ReportScreen`'s `onUpdateFields` (shared by
 * both the weekly and daily report screens): any `ReportCore` field, plus
 * optionally the period fields of *either* kind. The weekly report route
 * only ever sends `weekStart`/`weekEnd`; the daily route only ever sends
 * `date` -- this type just needs to be wide enough for both callers to
 * accept it, and structurally narrow enough that `Partial<WeeklyReport>` /
 * `Partial<DailyReport>` (what `useReports`/`useDailyReports` actually
 * declare) each accept a `ReportFieldPatch` argument.
 */
export type ReportFieldPatch = Partial<ReportCore> & { weekStart?: string; weekEnd?: string; date?: string };

/**
 * Shape of an in-progress (not-yet-saved) report, as produced by
 * blankDraft() / blankDailyDraft() / resumeDraft() in the prototype (and its
 * Phase 4 daily-report sibling). `id` is null until the first save.
 * `weekStart`/`weekEnd`/`date` are ALWAYS present regardless of `kind` (the
 * unused pair is just `''`) -- this keeps every wizard step's props
 * unconditional; only `StepBasics` branches on `kind`. Consumed by the
 * wizard (Pass 2 / Phase 4).
 */
export interface Draft {
  id: string | null;
  kind: ReportKind;
  weekStart: string;
  weekEnd: string;
  date: string;
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
