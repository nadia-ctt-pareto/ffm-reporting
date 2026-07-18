import type { AnyReport, DailyReport, Project, ReportCore, WeeklyReport } from '../types';

/**
 * Swappable persistence contract for reports. The MVP implementation is
 * localStorage-backed (LocalStorageReportsRepository); a future
 * SupabaseReportsRepository will implement this same interface. UI code
 * must never import a concrete repository directly -- only
 * getReportsRepository() from ./index.
 *
 * Phase 4: one unified store holds both weekly and daily reports (mirrors
 * the single `reports` SQL table, discriminated by `kind` -- see
 * supabase/migrations/20260717000002_daily_reports.sql). `getAll()` keeps
 * its pre-Phase-4 semantics (weeklies only) so every existing caller
 * (dashboard, weekly wizard, CSV, task/calendar views) is unaffected;
 * `getAllDaily()` is the new daily-only accessor.
 */
export interface ReportsRepository {
  /** Returns all WEEKLY reports only, seeding on first call if none exist yet. */
  getAll(): Promise<WeeklyReport[]>;
  /** Returns all DAILY reports only, seeding on first call if none exist yet. */
  getAllDaily(): Promise<DailyReport[]>;
  getById(id: string): Promise<AnyReport | null>;
  /** Insert if `report.id` is new, otherwise replace the existing report. */
  upsert(report: AnyReport): Promise<AnyReport>;
  /**
   * Shallow-merges `patch` into the existing report; returns null if not
   * found. Typed `Partial<ReportCore>` (the fields common to both kinds) so
   * the interface itself never needs to know which kind it's patching --
   * callers (useReports/useDailyReports) pass their own richer
   * `Partial<WeeklyReport>` / `Partial<DailyReport>` (including
   * `weekStart`/`weekEnd`/`date`), which is structurally assignable here
   * since it's a strict superset; the implementation spreads `patch`
   * verbatim at runtime, so those extra kind-specific fields still land.
   */
  update(id: string, patch: Partial<ReportCore>): Promise<AnyReport | null>;

  /**
   * Phase 6a: the Project entity. Returns all projects, seeding
   * `ff.projects.v1` from `seedProjects()` on first read (mirrors the
   * reports store's seed-on-first-read pattern). Additive, not a v1->v2
   * style migration -- see the V2_KEY comment in
   * local-storage-reports-repository.ts for why `ff.reports.v2` itself
   * needed no key bump for `projectId`.
   */
  getProjects(): Promise<Project[]>;
  /** Insert if `project.id` is new, otherwise replace the existing project. */
  upsertProject(project: Project): Promise<Project>;
}
