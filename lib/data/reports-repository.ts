import type { Report } from '../types';

/**
 * Swappable persistence contract for reports. The MVP implementation is
 * localStorage-backed (LocalStorageReportsRepository); a future
 * SupabaseReportsRepository will implement this same interface. UI code
 * must never import a concrete repository directly -- only
 * getReportsRepository() from ./index.
 */
export interface ReportsRepository {
  /** Returns all reports, seeding on first call if none exist yet. */
  getAll(): Promise<Report[]>;
  getById(id: string): Promise<Report | null>;
  /** Insert if `report.id` is new, otherwise replace the existing report. */
  upsert(report: Report): Promise<Report>;
  /** Shallow-merges `patch` into the existing report; returns null if not found. */
  update(id: string, patch: Partial<Report>): Promise<Report | null>;
}
