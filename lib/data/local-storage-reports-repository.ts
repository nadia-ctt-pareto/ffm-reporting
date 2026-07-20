import { ensureProjectIds } from '../projects';
import { seedDailyReports, seedProjects, seedReports } from '../seed';
import type { AnyReport, DailyReport, Project, ReportCore, WeeklyReport } from '../types';
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

  /** No write queue in this implementation -- every write above already resolves (or rejects, on a `localStorage` quota/serialization error) before its own promise settles, so there is nothing async left to wait on. Always resolves immediately. */
  async whenIdle(): Promise<void> {
    return;
  }
}
