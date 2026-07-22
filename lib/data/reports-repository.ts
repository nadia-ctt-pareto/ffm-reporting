import type { AnyReport, AssignedTask, AssignedTaskPatch, DailyReport, Project, ReportCore, TeamMember, WeeklyReport } from '../types';

/**
 * Swappable persistence contract for reports. The MVP implementation is
 * localStorage-backed (LocalStorageReportsRepository); `HttpReportsRepository`
 * (Phase 7b) is the Supabase-backed implementation. UI code must never
 * import a concrete repository directly -- only getReportsRepository()
 * from ./index.
 *
 * Phase 4: one unified store holds both weekly and daily reports (mirrors
 * the single `reports` SQL table, discriminated by `kind` -- see
 * supabase/migrations/20260717000002_daily_reports.sql). `getAll()` keeps
 * its pre-Phase-4 semantics (weeklies only) so every existing caller
 * (dashboard, weekly wizard, CSV, task/calendar views) is unaffected;
 * `getAllDaily()` is the new daily-only accessor.
 *
 * Post-review fix (SHOULD-FIX 15): this doc comment previously described
 * behavior only `LocalStorageReportsRepository` actually has (seed-on-
 * first-read, replace-by-id project upserts) -- `HttpReportsRepository`
 * does neither (Postgres is seeded once, out-of-band, by
 * `supabase/seed.sql`; its `upsertProject` is insert-or-return-EXISTING,
 * never a rename, see that class's own doc comment). The interface below
 * is now worded implementation-agnostically; the localStorage-specific
 * seeding/replace-by-id language lives on `LocalStorageReportsRepository`'s
 * own method doc comments instead, where it belongs.
 */
export interface ReportsRepository {
  /** Returns all WEEKLY reports. */
  getAll(): Promise<WeeklyReport[]>;
  /** Returns all DAILY reports. */
  getAllDaily(): Promise<DailyReport[]>;
  getById(id: string): Promise<AnyReport | null>;
  /** Insert if `report.id` is new, otherwise replace the existing report. */
  upsert(report: AnyReport): Promise<AnyReport>;
  /**
   * Phase 6b: batch upsert -- ONE `loadAll()` + ONE write for the whole
   * array, not N sequential `upsert()` round-trips. This matters because
   * `upsert()` is an async read-modify-write (load, then write back); firing
   * N of them without awaiting each one in turn is NOT safe -- all N can
   * read the SAME pre-batch snapshot before any of them writes, and then
   * race to write it back, so only the last write survives and the other
   * N-1 reports are silently dropped. `upsertMany` exists specifically so a
   * CSV-import-sized batch (mixed weeklies + dailies) commits atomically.
   * Accepts `AnyReport[]` (mixed kinds) since a single import run can
   * produce both.
   */
  upsertMany(reports: AnyReport[]): Promise<AnyReport[]>;
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
   * Phase 8d (report delete): deletes the report with `id`. In Supabase mode, access is decided
   * entirely by `reports_delete` RLS (owner-or-admin) -- children (tasks/
   * risks/priorities) cascade via the FK, and any live share token simply
   * stops resolving (see `lib/server/reports-service.ts`'s `deleteReport`
   * doc comment for the full story). In demo mode, `LocalStorageReportsRepository`
   * has no owner/admin concept at all (same posture as its `renameProject`/
   * `deleteProject`), so any caller may delete any locally-stored report --
   * the only failure mode there is a missing id. Rejects if `id` doesn't
   * exist (or, in Supabase mode, isn't visible/permitted to this caller) --
   * see each implementation's own doc comment for exactly how that's
   * enforced/curated.
   */
  deleteReport(id: string): Promise<void>;

  /**
   * Phase 6a: the Project entity. Returns all projects.
   */
  getProjects(): Promise<Project[]>;
  /** Ensures a project with this id exists; returns it. See each implementation's own doc comment for the exact insert-vs-replace semantics on an id collision -- they genuinely differ (`LocalStorageReportsRepository` replaces by id, i.e. supports rename; `HttpReportsRepository` returns the existing row unchanged, i.e. never renames). */
  upsertProject(project: Project): Promise<Project>;
  /**
   * Phase 8c: renames EXACTLY a project's `name` -- a dedicated method
   * rather than piggybacking on `upsertProject` because the semantics
   * genuinely diverge (see that method's own doc comment on the two
   * implementations' different id-collision behavior). Never touches `id`;
   * never rewrites any task/risk `client` string or `projectId` link -- see
   * CLAUDE.md's "THE CRUX -- rename safety". Rejects (see each
   * implementation's own doc comment) on a missing id or a duplicate name.
   */
  renameProject(id: string, name: string): Promise<Project>;
  /**
   * Phase 8c: deletes a project ONLY when unreferenced by any report/task/
   * risk `projectId` -- rejects with a curated "still referenced" message
   * otherwise. See each implementation's own doc comment for exactly how
   * that's enforced (a DB FK in `HttpReportsRepository`'s case; a scan over
   * every `AnyReport` in `LocalStorageReportsRepository`'s).
   */
  deleteProject(id: string): Promise<void>;

  /**
   * WP1: the TeamMember entity (a directory, see lib/schema/team.ts's
   * header comment -- `role` here is a LABEL, not an access grant). Returns
   * all team members.
   */
  getTeamMembers(): Promise<TeamMember[]>;
  /**
   * Ensures a team member with this id exists; returns it. See each
   * implementation's own doc comment for the exact insert-vs-replace
   * semantics on an id collision -- they genuinely differ, mirroring
   * `upsertProject`'s own documented split exactly (`LocalStorageReportsRepository`
   * replaces by id, i.e. supports rename; `HttpReportsRepository` returns
   * the existing row unchanged, i.e. never renames).
   */
  upsertTeamMember(member: TeamMember): Promise<TeamMember>;
  /**
   * Renames EXACTLY a team member's `name` -- a dedicated method rather than
   * piggybacking on `upsertTeamMember`, for the same reason `renameProject`
   * is dedicated rather than piggybacked on `upsertProject` (see that
   * method's own doc comment). Never touches `role`/`email`/`userId`.
   * Rejects (see each implementation's own doc comment) on a missing id or
   * a duplicate name.
   */
  renameTeamMember(id: string, name: string): Promise<TeamMember>;
  /**
   * Deletes a team member. Unlike `deleteProject`, this does NOT check for
   * references before deleting -- no FK/relationship points AT a team
   * member yet in this package (a later package's task-assignee field will
   * add one; `HttpReportsRepository`'s implementation is already
   * forward-shaped for that day, see `lib/server/reports-service.ts`'s
   * `deleteTeamMember`). Rejects on a missing id (or, in Supabase mode, an
   * id not permitted to this caller).
   */
  deleteTeamMember(id: string): Promise<void>;

  /**
   * WP3 (the access flip): the CALLER's own assigned tasks, joined with
   * bounded parent-report context only (see `AssignedTask`'s own doc
   * comment, lib/types.ts). Demo mode returns `[]` unconditionally --
   * every report in demo mode is already "yours" (no auth, no per-user
   * scoping at all), so there is no separate assignee-visibility gap for
   * this to bridge there; `HttpReportsRepository`'s implementation calls
   * `GET /api/tasks/assigned` -> `list_assigned_tasks()`.
   */
  getAssignedTasks(): Promise<AssignedTask[]>;
  /**
   * WP3: patches ONLY `status`/`deadline`/`completedAt` on the task with
   * `taskId` -- see `AssignedTaskPatch`'s own doc comment (lib/types.ts) for
   * why this is narrower than `update()`'s `Partial<ReportCore>`.
   * `LocalStorageReportsRepository` finds the task across every stored
   * report (a task's id doesn't carry its parent report's id in this
   * store's index), patches it in place, and bumps that report's
   * `updatedAt`; `HttpReportsRepository` calls `PATCH /api/tasks/[id]` ->
   * `update_assigned_task()` (owner-or-assignee, enforced server-side).
   * Rejects if `taskId` doesn't exist (or, in Supabase mode, isn't owned by
   * or assigned to this caller).
   */
  updateTask(taskId: string, patch: AssignedTaskPatch): Promise<AssignedTask>;

  /**
   * Post-review addition (SHOULD-FIX 13, Phase 7b): resolves once every
   * write this repository instance has queued SO FAR has settled (success
   * or failure) -- a no-op, immediately-resolved `Promise<void>` for
   * `LocalStorageReportsRepository` (every write there is already
   * synchronous-under-the-hood; there is no queue to wait on).
   * `HttpReportsRepository` resolves it against its own write-serialization
   * queue (`enqueueWrite`, that class's header comment). Exists so a hook's
   * rollback-by-refetch (`useReports.ts`/`useDailyReports.ts`/
   * `useProjects.ts`'s `rollback()`) can wait for any IN-FLIGHT write to
   * settle before reading "server truth" -- without this, a rollback
   * triggered by write A's failure could read stale data while write B
   * (queued right behind A) is still in flight, then overwrite B's
   * optimistic UI state with that stale read even though B goes on to
   * succeed. This is the exact "silently revert a task" bug class the
   * write queue exists to prevent, reintroduced on the READ side -- see
   * `rollback()`'s doc comment in useReports.ts for the full scenario.
   */
  whenIdle(): Promise<void>;
}
