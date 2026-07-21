// Phase 8c (project management): a pure derivation selector over
// `Report[]`/`DailyReport[]` for a single `Project` -- no new storage,
// nothing here reads/writes localStorage or the repository. Mirrors the
// style of `lib/view-utils.ts` (Phase 3): a plain function, no React, no
// side effects, so `components/projects/ProjectsScreen.tsx` (list stats)
// and `components/projects/ProjectDetailScreen.tsx` (full rollup) can both
// call it directly.
//
// Membership is id-or-exact-name, deliberately mirroring the dashboard's
// client-filter fix (CLAUDE.md's "THE CRUX -- rename safety"): a task/risk
// belongs to a project if its `projectId` matches OR its `client` string
// exactly equals the project's CURRENT `name`. The `projectId` branch is
// rename-proof (it's the stable link); the `client` branch is what keeps a
// pre-projectId-backfill or pre-rename historical item associated with the
// right project even though its own `client` string was never rewritten
// (and never should be -- see CLAUDE.md's crux section). Both branches are
// exact matches only, never fuzzy -- same posture as
// `projectIdForClientName` (lib/projects.ts).

import { reportPeriodEnd } from './report-utils';
import type { AnyReport, DailyReport, Project, Report, Risk, Task } from './types';

export interface ProjectTaskEntry {
  report: AnyReport;
  task: Task;
}

export interface ProjectRiskEntry {
  report: AnyReport;
  risk: Risk;
}

export interface ProjectRollup {
  /** Every weekly + daily report associated with this project (see `reportMatches` below), newest period first. */
  reports: AnyReport[];
  /** Tasks belonging to this project, across every associated report, that are NOT yet `'Complete'` (i.e. `'Blocked'` or `'In Progress'`). */
  openTasks: ProjectTaskEntry[];
  /** The subset of `openTasks` whose status is specifically `'Blocked'`. */
  blockedTasks: ProjectTaskEntry[];
  /** Every risk belonging to this project, across every associated report. */
  risks: ProjectRiskEntry[];
}

/** True when `item` (a task or risk) belongs to `project` -- id-or-exact-name, see this file's header comment. */
function itemBelongsToProject(item: Pick<Task | Risk, 'client' | 'projectId'>, project: Project): boolean {
  return item.projectId === project.id || item.client === project.name;
}

/**
 * True when `report` is associated with `project` -- either the report
 * itself is project-scoped (`report.projectId === project.id`, e.g. a
 * CSV-imported single-client report), or it's a house-authored,
 * multi-client report that has at least one task/risk belonging to this
 * project (the common seed-data shape: one weekly report whose tasks span
 * all four clients).
 */
function reportMatches(report: AnyReport, project: Project): boolean {
  return report.projectId === project.id || report.tasks.some((t) => itemBelongsToProject(t, project)) || report.risks.some((r) => itemBelongsToProject(r, project));
}

/**
 * Builds the full rollup for `project` out of every currently-loaded weekly
 * (`Report[]` -- see `lib/types.ts`'s `Report = WeeklyReport` alias) and
 * daily report. Pure -- callers (`ProjectsScreen`/`ProjectDetailScreen`)
 * pass in whatever `useReports()`/`useDailyReports()` already loaded; this
 * function does no fetching of its own.
 */
export function projectRollup(project: Project, weeklies: Report[], dailies: DailyReport[]): ProjectRollup {
  const allReports: AnyReport[] = [...weeklies, ...dailies];
  const reports = allReports
    .filter((r) => reportMatches(r, project))
    .sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)));

  const openTasks: ProjectTaskEntry[] = [];
  const blockedTasks: ProjectTaskEntry[] = [];
  const risks: ProjectRiskEntry[] = [];

  for (const report of reports) {
    for (const task of report.tasks) {
      if (!itemBelongsToProject(task, project)) continue;
      if (task.status === 'Blocked') blockedTasks.push({ report, task });
      if (task.status !== 'Complete') openTasks.push({ report, task });
    }
    for (const risk of report.risks) {
      if (!itemBelongsToProject(risk, project)) continue;
      risks.push({ report, risk });
    }
  }

  return { reports, openTasks, blockedTasks, risks };
}

/**
 * True when `project` is referenced by ANY report/task/risk's `projectId`
 * -- id-ONLY, deliberately NOT the id-or-exact-name fallback `projectRollup`
 * above uses for its broader "associated with this project" view. This is
 * what a delete would actually be blocked on: the SQL FK
 * (`reports`/`tasks`/`risks`.`project_id`, `NO ACTION`,
 * supabase/migrations/20260718000003_projects.sql) only ever looks at
 * `project_id`, never at a `client` string match -- so a house-authored
 * report whose tasks merely happen to name this project (no `projectId`
 * stamped) is NOT what blocks a delete, even though it DOES show up in
 * `projectRollup`'s "associated reports" list. Powers
 * `ProjectDetailScreen.tsx`'s Delete confirmation (disabled + explained
 * when this is true) -- kept in sync with `deleteProject`'s own
 * unreferenced check in both repository implementations (lib/data/
 * local-storage-reports-repository.ts, and the SQL FK for
 * `HttpReportsRepository`) so the UI's disabled state and the server's
 * actual rejection can never disagree.
 */
export function projectIsReferenced(project: Project, weeklies: Report[], dailies: DailyReport[]): boolean {
  const allReports: AnyReport[] = [...weeklies, ...dailies];
  return allReports.some(
    (r) => r.projectId === project.id || r.tasks.some((t) => t.projectId === project.id) || r.risks.some((rk) => rk.projectId === project.id)
  );
}
