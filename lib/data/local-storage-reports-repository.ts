import { seedDailyReports, seedReports } from '../seed';
import type { AnyReport, DailyReport, ReportCore, WeeklyReport } from '../types';
import type { ReportsRepository } from './reports-repository';

/** Phase 1-3 key: `WeeklyReport[]` only (no `kind` field). Never written to post-Phase-4 -- kept only as a migration source/backup, see migrateV1ToV2 below. */
const V1_KEY = 'ff.weekly-reports.v1';
/** Phase 4 key: `AnyReport[]` (weeklies + dailies, discriminated by `kind`). */
const V2_KEY = 'ff.reports.v2';

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
  private readV2(): AnyReport[] | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(V2_KEY);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored v2 reports payload is not an array.');
      return parsed as AnyReport[];
    } catch {
      return null;
    }
  }

  private readV1(): WeeklyReport[] | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(V1_KEY);
    if (raw == null) return null;
    try {
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

  /** Stamps `kind: 'weekly'` on every v1 record and persists it to v2. Never touches/deletes the v1 key. */
  private migrateV1ToV2(v1Reports: WeeklyReport[]): AnyReport[] {
    const migrated: AnyReport[] = v1Reports.map((r) => ({ ...r, kind: 'weekly' as const }));
    this.writeV2(migrated);
    return migrated;
  }

  private seedAndPersist(): AnyReport[] {
    const seeded: AnyReport[] = [...seedReports(), ...seedDailyReports()];
    this.writeV2(seeded);
    return seeded;
  }

  /** v2 present & valid -> use it. v2 absent/corrupt -> migrate from v1 if present & valid. Neither -> reseed. */
  private async loadAll(): Promise<AnyReport[]> {
    if (typeof window === 'undefined') return [];
    const v2 = this.readV2();
    if (v2 !== null) return v2;
    const v1 = this.readV1();
    if (v1 !== null) return this.migrateV1ToV2(v1);
    return this.seedAndPersist();
  }

  async getAll(): Promise<WeeklyReport[]> {
    const all = await this.loadAll();
    return all.filter((r): r is WeeklyReport => r.kind === 'weekly');
  }

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
}
