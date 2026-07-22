import { nowDate } from '../format';
import { ensureProjectIds } from '../projects';
import { seedDailyReports, seedProjects, seedReports, seedTeamMembers } from '../seed';
import type { AnyReport, AssignedTask, AssignedTaskPatch, DailyReport, Project, ReportCore, Task, TeamMember, WeeklyReport } from '../types';
import type { ReportsRepository } from './reports-repository';

/** Phase 1-3 key: `WeeklyReport[]` only (no `kind` field). Never written to post-Phase-4 -- kept only as a migration source/backup, see migrateV1ToV2 below. */
const V1_KEY = 'ff.weekly-reports.v1';
/**
 * Phase 4 key: `AnyReport[]` (weeklies + dailies, discriminated by `kind`).
 *
 * Phase 6a note: adding `projectId` to tasks/risks/reports did NOT bump this
 * key. The v1->v2 backup discipline exists for *destructive* reshapes (v1->v2
 * re-keyed the store and stamped a new `kind` discriminant onto every
 * record) -- this is not one. A record without `projectId` remains a fully
 * valid `AnyReport` (the schema marks it `.nullish()`), no existing field is
 * reshaped or reinterpreted, and no old reader exists that the new shape
 * could confuse. See ensureProjectIds() in loadAll() below for how existing
 * records get `projectId` stamped in place, lazily.
 */
const V2_KEY = 'ff.reports.v2';
/** Phase 6a: the Project entity's store, seeded from seedProjects() on first read. */
const PROJECTS_KEY = 'ff.projects.v1';
/** WP1: the TeamMember entity's store, seeded from seedTeamMembers() on first read -- mirrors PROJECTS_KEY exactly. */
const TEAM_KEY = 'ff.team.v1';

/**
 * MVP persistence: browser localStorage. One unified v2 store holds both
 * weekly and daily reports (mirrors the single SQL `reports` table).
 * Guards every access behind `typeof window` so it is safe to import from
 * server-rendered code paths (it just becomes a no-op).
 *
 * **v1 -> v2 migration (data-safety top priority, see CLAUDE.md "Migrations
 * discipline")**: on first read, if v2 is absent, this reads the old
 * `ff.weekly-reports.v1` payload (if present), stamps `kind: 'weekly'` on
 * every record, and writes it to v2 -- the v1 key is INTENTIONALLY left in
 * place afterward (never deleted), purely as a backup, so a bug anywhere in
 * this migration or in any future v2 consumer can never lose a user's
 * already-saved reports. If v2 is present but corrupt (unparsable/not an
 * array), the same v1-first recovery path runs before falling back to
 * reseeding -- reseeding (which discards whatever was in v2) is the last
 * resort, only when neither a valid v2 nor a valid v1 payload exists.
 */
export class LocalStorageReportsRepository implements ReportsRepository {
  // NIT fix (post-review round 2): `window.localStorage.getItem(...)` used
  // to sit OUTSIDE this method's `try` -- harmless on every browser except
  // a Safari private-mode tab, where even `getItem` (not just `setItem`)
  // throws a `SecurityError`, which propagated straight up as an
  // unhandled-looking exception instead of the null/reseed fallback path
  // every OTHER failure mode here already gets. `getItem` now shares the
  // same `try` as the `JSON.parse`/shape check below, so every failure mode
  // degrades identically (see loadAll()'s v1-first-recovery-then-reseed
  // fallback, which is what actually runs once this returns `null`).
  private readV2(): AnyReport[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(V2_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored v2 reports payload is not an array.');
      return parsed as AnyReport[];
    } catch {
      return null;
    }
  }

  private readV1(): WeeklyReport[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(V1_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored v1 reports payload is not an array.');
      return parsed as WeeklyReport[];
    } catch {
      return null;
    }
  }

  private writeV2(reports: AnyReport[]): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(V2_KEY, JSON.stringify(reports));
  }

  /**
   * Stamps `kind: 'weekly'` on every v1 record. Pure -- does NOT write to v2
   * itself (never touches/deletes the v1 key either way). See loadAll()
   * below for why: the Phase 6a `projectId` backfill must land in the SAME
   * write as this migration, not a second one, so a write failure (e.g.
   * quota) can never leave the store valid-but-unstamped after an
   * already-"succeeded" first write.
   */
  private migrateV1ToV2(v1Reports: WeeklyReport[]): AnyReport[] {
    return v1Reports.map((r) => ({ ...r, kind: 'weekly' as const }));
  }

  private readProjects(): Project[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(PROJECTS_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored projects payload is not an array.');
      return parsed as Project[];
    } catch {
      return null;
    }
  }

  private writeProjects(projects: Project[]): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  /** ff.projects.v1 present & valid -> use it. Absent/corrupt -> seed from seedProjects() and persist. No v1->v2-style migration needed -- this key didn't exist before Phase 6a. */
  private async loadProjects(): Promise<Project[]> {
    if (typeof window === 'undefined') return [];
    const existing = this.readProjects();
    if (existing !== null) return existing;
    const seeded = seedProjects();
    this.writeProjects(seeded);
    return seeded;
  }

  /** WP1: same read/parse/fallback shape as `readProjects()` above -- mirrors it verbatim for the `TEAM_KEY` store. */
  private readTeamMembers(): TeamMember[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(TEAM_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored team members payload is not an array.');
      return parsed as TeamMember[];
    } catch {
      return null;
    }
  }

  private writeTeamMembers(members: TeamMember[]): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TEAM_KEY, JSON.stringify(members));
  }

  /** ff.team.v1 present & valid -> use it. Absent/corrupt -> seed from seedTeamMembers() and persist -- mirrors `loadProjects()` exactly. */
  private async loadTeamMembers(): Promise<TeamMember[]> {
    if (typeof window === 'undefined') return [];
    const existing = this.readTeamMembers();
    if (existing !== null) return existing;
    const seeded = seedTeamMembers();
    this.writeTeamMembers(seeded);
    return seeded;
  }

  /**
   * v2 present & valid -> use it (WARM path). v2 absent/corrupt -> migrate
   * from v1 if present & valid, else reseed (COLD path).
   *
   * Phase 6a lazy backfill: whichever path resolved `reports`, run
   * `ensureProjectIds()` against the current project list before persisting
   * anything.
   *
   * - WARM path: write back ONLY if something actually got stamped
   *   (`changed`) -- so a browser that already has every task/risk's
   *   `projectId` stamped (the common case, after the very first
   *   post-upgrade load) never re-writes `ff.reports.v2` on every
   *   subsequent read.
   * - COLD path (fresh reseed or a v1->v2 migration): the raw
   *   migrated/seeded payload is backfilled BEFORE the single `writeV2` --
   *   never written once unbackfilled and then rewritten a second time.
   *   That second write was previously the migration/seed's OWN write being
   *   immediately superseded by the backfill's write; if that second write
   *   had thrown (e.g. quota), the store would have been left
   *   valid-but-unstamped. Now there is exactly one write on this path.
   *
   * This is the one place backfill happens; every other repository method
   * goes through here.
   */
  private async loadAll(): Promise<AnyReport[]> {
    if (typeof window === 'undefined') return [];
    const projects = await this.loadProjects();

    const v2 = this.readV2();
    if (v2 !== null) {
      const backfilled = ensureProjectIds(v2, projects);
      if (backfilled.changed) this.writeV2(backfilled.reports);
      return backfilled.reports;
    }

    const v1 = this.readV1();
    const raw: AnyReport[] = v1 !== null ? this.migrateV1ToV2(v1) : [...seedReports(), ...seedDailyReports()];
    const backfilled = ensureProjectIds(raw, projects);
    this.writeV2(backfilled.reports);
    return backfilled.reports;
  }

  /** Returns all WEEKLY reports, seeding `ff.reports.v2` (or migrating `ff.weekly-reports.v1`) on first call if neither exists yet -- see `loadAll()`. */
  async getAll(): Promise<WeeklyReport[]> {
    const all = await this.loadAll();
    return all.filter((r): r is WeeklyReport => r.kind === 'weekly');
  }

  /** Returns all DAILY reports -- same seed-on-first-call behavior as `getAll()`. */
  async getAllDaily(): Promise<DailyReport[]> {
    const all = await this.loadAll();
    return all.filter((r): r is DailyReport => r.kind === 'daily');
  }

  async getById(id: string): Promise<AnyReport | null> {
    const all = await this.loadAll();
    return all.find((r) => r.id === id) ?? null;
  }

  async upsert(report: AnyReport): Promise<AnyReport> {
    const all = await this.loadAll();
    const exists = all.some((r) => r.id === report.id);
    const next = exists ? all.map((r) => (r.id === report.id ? report : r)) : [...all, report];
    this.writeV2(next);
    return report;
  }

  /**
   * Phase 6b: batch upsert -- ONE `loadAll()` and ONE `writeV2()` for the
   * whole array (see the doc comment on `ReportsRepository.upsertMany`).
   * Insert-or-replace-by-id, same semantics as `upsert()`, just batched.
   */
  async upsertMany(reports: AnyReport[]): Promise<AnyReport[]> {
    if (reports.length === 0) return reports;
    const all = await this.loadAll();
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const r of reports) byId.set(r.id, r);
    this.writeV2([...byId.values()]);
    return reports;
  }

  async update(id: string, patch: Partial<ReportCore>): Promise<AnyReport | null> {
    const all = await this.loadAll();
    let updated: AnyReport | null = null;
    const next = all.map((r) => {
      if (r.id !== id) return r;
      // `patch` may carry weekStart/weekEnd/date at runtime even though the
      // interface only types it as Partial<ReportCore> -- see the doc
      // comment on ReportsRepository.update(). The spread below applies
      // whatever's actually present.
      updated = { ...r, ...patch } as AnyReport;
      return updated;
    });
    if (!updated) return null;
    this.writeV2(next);
    return updated;
  }

  /**
   * Phase 8d (report delete): deletes the report with `id`. Demo mode has no owner/admin concept
   * (same posture as `renameProject`/`deleteProject` above -- there is no
   * RLS-equivalent layer to enforce it at, so every caller is trusted with
   * every locally-stored report). Unlike `deleteProject` (which scans for
   * references before allowing a delete), a report has no analogous
   * "still referenced" concern -- nothing else in this store points AT a
   * report by id (a `projectId` link points FROM a report/task/risk TO a
   * project, never the reverse), so this is a plain filter + single write.
   * Throws if `id` doesn't exist, mirroring `renameProject`'s "throw on a
   * missing id" posture.
   *
   * CAVEAT (surfaced by security review): this rewrites `ff.reports.v2` only
   * and deliberately leaves the legacy `ff.weekly-reports.v1` key alone, per
   * this file's v1-is-a-permanent-backup policy (see the header comment and
   * `loadAll`). Because `loadAll` falls back to v1 whenever v2 is absent OR
   * corrupt, a browser still carrying a pre-Phase-4 v1 payload can resurrect a
   * deleted weekly report if v2 is later cleared or corrupted -- so the
   * confirm dialog's "This cannot be undone." is strictly true in Supabase
   * mode (where the row is really gone and the FK cascade takes its children)
   * but slightly overstated in demo mode. Left as-is on purpose: the v1
   * backup exists precisely so a bug in this store can never destroy a user's
   * only copy, and weakening the dialog copy to hedge about a demo-only
   * backup key would make the real, deployed behavior sound less final than
   * it is.
   */
  async deleteReport(id: string): Promise<void> {
    const all = await this.loadAll();
    if (!all.some((r) => r.id === id)) throw new Error(`Report ${id} not found.`);
    this.writeV2(all.filter((r) => r.id !== id));
  }

  /** Returns all projects, seeding `ff.projects.v1` from `seedProjects()` on first read -- see `loadProjects()`. */
  async getProjects(): Promise<Project[]> {
    return this.loadProjects();
  }

  /** Insert if `project.id` is new, otherwise REPLACE the existing project by id (a rename is possible this way -- genuinely different from `HttpReportsRepository.upsertProject`, see that class's doc comment). */
  async upsertProject(project: Project): Promise<Project> {
    const all = await this.loadProjects();
    const exists = all.some((p) => p.id === project.id);
    const next = exists ? all.map((p) => (p.id === project.id ? project : p)) : [...all, project];
    this.writeProjects(next);
    return project;
  }

  /**
   * Phase 8c: renames EXACTLY the `name` field of the project with `id` --
   * `id` itself and every other field are untouched, and no task/risk
   * `client` string or `projectId` link anywhere in `ff.reports.v2` is ever
   * read or written by this method (see CLAUDE.md's "THE CRUX -- rename
   * safety"). Demo mode has no admin/session concept (see
   * `components/projects/ProjectDetailScreen.tsx`'s own doc comment on how
   * it decides who sees the Rename/Delete controls here) -- this method
   * itself performs no such gating, matching every other localStorage
   * repository method (there is no RLS-equivalent layer to enforce it at).
   * Throws if `id` doesn't exist, or if a DIFFERENT existing project
   * already has this exact `name` (mirrors SQL's `projects_name_key` unique
   * constraint).
   */
  async renameProject(id: string, name: string): Promise<Project> {
    const all = await this.loadProjects();
    const existing = all.find((p) => p.id === id);
    if (!existing) throw new Error(`Project ${id} not found.`);
    const duplicate = all.find((p) => p.id !== id && p.name === name);
    if (duplicate) throw new Error(`A project named "${name}" already exists.`);
    const renamed: Project = { ...existing, name };
    this.writeProjects(all.map((p) => (p.id === id ? renamed : p)));
    return renamed;
  }

  /**
   * Phase 8c: deletes a project only when UNREFERENCED -- scans every
   * `AnyReport` in `ff.reports.v2` for a report-level `projectId === id`, or
   * a task/risk within it whose `projectId === id`, and throws (rather than
   * deleting) if any exist. This mirrors the SQL FK's `NO ACTION` authority
   * (supabase/migrations/20260718000003_projects.sql) -- the DB is the real
   * authority in Supabase mode; this scan is demo mode's own enforcement of
   * the identical rule, since there is no FK to lean on here.
   */
  async deleteProject(id: string): Promise<void> {
    const projects = await this.loadProjects();
    if (!projects.some((p) => p.id === id)) throw new Error(`Project ${id} not found.`);
    const reports = await this.loadAll();
    const referenced = reports.some(
      (r) => r.projectId === id || r.tasks.some((t) => t.projectId === id) || r.risks.some((rk) => rk.projectId === id)
    );
    if (referenced) throw new Error('This project is still referenced by existing reports.');
    this.writeProjects(projects.filter((p) => p.id !== id));
  }

  /** Returns all team members, seeding `ff.team.v1` from `seedTeamMembers()` on first read -- mirrors `getProjects()`. */
  async getTeamMembers(): Promise<TeamMember[]> {
    return this.loadTeamMembers();
  }

  /** Insert if `member.id` is new, otherwise REPLACE the existing member by id (a rename is possible this way, mirroring `upsertProject`'s identical local-storage-only convenience -- genuinely different from `HttpReportsRepository.upsertTeamMember`, see that class's doc comment). */
  async upsertTeamMember(member: TeamMember): Promise<TeamMember> {
    const all = await this.loadTeamMembers();
    const exists = all.some((m) => m.id === member.id);
    const next = exists ? all.map((m) => (m.id === member.id ? member : m)) : [...all, member];
    this.writeTeamMembers(next);
    return member;
  }

  /**
   * WP1: renames EXACTLY the `name` field of the member with `id` -- `id`,
   * `role`, `email`, and `userId` are all untouched, mirroring
   * `renameProject`'s identical name-only contract. Demo mode has no
   * admin/session concept (see `components/team/TeamManager.tsx`'s own doc
   * comment on how it decides who sees the controls) -- this method
   * performs no such gating itself, matching every other localStorage
   * repository method. Throws if `id` doesn't exist, or if a DIFFERENT
   * existing member already has this exact `name` (mirrors SQL's
   * `team_members_name_key` unique constraint).
   */
  async renameTeamMember(id: string, name: string): Promise<TeamMember> {
    const all = await this.loadTeamMembers();
    const existing = all.find((m) => m.id === id);
    if (!existing) throw new Error(`Team member ${id} not found.`);
    const duplicate = all.find((m) => m.id !== id && m.name === name);
    if (duplicate) throw new Error(`A team member named "${name}" already exists.`);
    const renamed: TeamMember = { ...existing, name };
    this.writeTeamMembers(all.map((m) => (m.id === id ? renamed : m)));
    return renamed;
  }

  /**
   * WP1: deletes a team member. No reference scan (unlike `deleteProject`)
   * -- no locally-stored `AnyReport`/task/risk carries a link TO a team
   * member in this package (a later package's task-assignee field would
   * add one, at which point this method should gain the same "referenced"
   * scan `deleteProject` already does). Throws if `id` doesn't exist,
   * mirroring `renameProject`'s "throw on a missing id" posture.
   */
  async deleteTeamMember(id: string): Promise<void> {
    const all = await this.loadTeamMembers();
    if (!all.some((m) => m.id === id)) throw new Error(`Team member ${id} not found.`);
    this.writeTeamMembers(all.filter((m) => m.id !== id));
  }

  /**
   * WP3 (the access flip): demo mode has no auth/ownership concept at all --
   * every report here is already fully accessible to whoever has this
   * browser, so there is no separate "tasks assigned to me but on a report
   * I don't otherwise see" surface to bridge (unlike Supabase mode, where
   * `list_assigned_tasks()` genuinely widens visibility past `reports_select`).
   * Always `[]`, matching `ReportsRepository.getAssignedTasks`'s own doc
   * comment.
   */
  async getAssignedTasks(): Promise<AssignedTask[]> {
    return [];
  }

  /**
   * WP3: unlike every other localStorage method above, a task's id doesn't
   * carry its parent report's id in this store's shape -- so this scans
   * every stored `AnyReport` for the one whose `tasks` array contains
   * `taskId`, patches ONLY that task (shallow-merging `patch`, mirroring
   * `withTaskEdited`'s own "narrow field patch" shape, lib/report-utils.ts --
   * not reused directly here since that helper's signature is built around
   * the wizard's `today`-stamping contract, which this narrow patch has no
   * use for), and bumps the OWNING report's `updatedAt` (matching
   * `update_assigned_task`'s server-side behavior). Demo mode has no
   * owner-or-assignee gate of its own (same posture as every other
   * localStorage method -- there is no RLS-equivalent layer to enforce it
   * at); this method exists mainly so the interface is fully implemented
   * and demo mode's behavior doesn't silently diverge in shape from
   * Supabase mode's. Throws if `taskId` doesn't exist in any report.
   */
  async updateTask(taskId: string, patch: AssignedTaskPatch): Promise<AssignedTask> {
    const all = await this.loadAll();
    let updatedReport: AnyReport | null = null;
    let updatedTask: Task | null = null;
    const next = all.map((r) => {
      if (updatedTask || !r.tasks.some((t) => t.id === taskId)) return r;
      const tasks = r.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
      const merged = { ...r, tasks, updatedAt: nowDate() } as AnyReport;
      updatedReport = merged;
      updatedTask = tasks.find((t) => t.id === taskId) ?? null;
      return merged;
    });
    if (!updatedReport || !updatedTask) throw new Error(`Task ${taskId} not found.`);
    this.writeV2(next);
    const finalReport = updatedReport as AnyReport;
    const finalTask = updatedTask as Task;
    return {
      ...finalTask,
      reportId: finalReport.id,
      reportKind: finalReport.kind,
      weekStart: finalReport.kind === 'weekly' ? finalReport.weekStart : undefined,
      weekEnd: finalReport.kind === 'weekly' ? finalReport.weekEnd : undefined,
      date: finalReport.kind === 'daily' ? finalReport.date : undefined,
      preparedFor: finalReport.preparedFor,
    };
  }

  /** No write queue in this implementation -- every write above already resolves (or rejects, on a `localStorage` quota/serialization error) before its own promise settles, so there is nothing async left to wait on. Always resolves immediately. */
  async whenIdle(): Promise<void> {
    return;
  }
}
