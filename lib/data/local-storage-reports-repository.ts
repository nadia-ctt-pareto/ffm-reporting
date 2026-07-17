import { seedReports } from '../seed';
import type { Report } from '../types';
import type { ReportsRepository } from './reports-repository';

const STORAGE_KEY = 'ff.weekly-reports.v1';

/**
 * MVP persistence: browser localStorage. Seeds the 7 prototype reports on
 * first read (when the key is absent), and reseeds if the stored payload is
 * corrupt/unparsable. Guards every access behind `typeof window` so it is
 * safe to import from server-rendered code paths (it just becomes a no-op).
 */
export class LocalStorageReportsRepository implements ReportsRepository {
  private readStored(): Report[] | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Stored reports payload is not an array.');
      return parsed as Report[];
    } catch {
      return null;
    }
  }

  private writeStored(reports: Report[]): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  }

  private seedAndPersist(): Report[] {
    const seeded = seedReports();
    this.writeStored(seeded);
    return seeded;
  }

  async getAll(): Promise<Report[]> {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return this.seedAndPersist();
    const parsed = this.readStored();
    return parsed ?? this.seedAndPersist();
  }

  async getById(id: string): Promise<Report | null> {
    const all = await this.getAll();
    return all.find((r) => r.id === id) ?? null;
  }

  async upsert(report: Report): Promise<Report> {
    const all = await this.getAll();
    const exists = all.some((r) => r.id === report.id);
    const next = exists ? all.map((r) => (r.id === report.id ? report : r)) : [...all, report];
    this.writeStored(next);
    return report;
  }

  async update(id: string, patch: Partial<Report>): Promise<Report | null> {
    const all = await this.getAll();
    let updated: Report | null = null;
    const next = all.map((r) => {
      if (r.id !== id) return r;
      updated = { ...r, ...patch };
      return updated;
    });
    if (!updated) return null;
    this.writeStored(next);
    return updated;
  }
}
