'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { nowDate } from '../format';
import { resolveLoadError } from './load-error';
import type { DailyReport } from '../types';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Phase 4: the daily-report sibling of useReports.ts -- identical
 * optimistic-update pattern, but reads/writes DailyReport[] via
 * `getReportsRepository().getAllDaily()`. Still only ever goes through
 * `getReportsRepository()`, never a concrete repository class.
 *
 * Phase 7b: mirrors useReports.ts's failure-resilience contract exactly --
 * see that file's doc comments for `loadError`/`mutationError`/the
 * resolve-or-rollback-and-reject mutation contract/`enabled`.
 */
export interface UseDailyReportsOptions {
  enabled?: boolean;
}

export interface UseDailyReportsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  reports: DailyReport[] | null;
  loadError: string | null;
  mutationError: string | null;
  /** Optimistic local update + persistence -- resolves on success, rejects (after rollback) on failure. */
  upsertReport: (report: DailyReport) => Promise<void>;
  /** Phase 6b: batch sibling of `upsertReport` -- see `useReports.ts`'s `upsertMany` doc comment (identical rationale/contract, mirrored for dailies). */
  upsertMany: (reports: DailyReport[]) => Promise<void>;
  /** Shallow-merges `patch` (plus a fresh `updatedAt`) into the report with `id`. */
  updateReportFields: (id: string, patch: Partial<DailyReport>) => Promise<void>;
  /** Phase 8d (report delete): deletes the report with `id` -- see `useReports.ts`'s `deleteReport` doc comment for the full non-optimistic rationale (identical here, mirrored for dailies). */
  deleteReport: (id: string) => Promise<void>;
}

export function useDailyReports(options?: UseDailyReportsOptions): UseDailyReportsResult {
  const enabled = options?.enabled ?? true;
  const [reports, setReports] = useState<DailyReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getReportsRepository()
      .getAllDaily()
      .then((all) => {
        if (cancelled) return;
        setReports(all);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Post-review fix (SHOULD-FIX 11) -- see useReports.ts's identical catch for the full rationale.
        const message = resolveLoadError(err, 'Failed to load daily reports.');
        if (message !== null) setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /** Post-review fix (SHOULD-FIX 13) -- see useReports.ts's `rollback` doc comment for the full rationale (identical here, mirrored for dailies). */
  const rollback = useCallback(async () => {
    try {
      await getReportsRepository().whenIdle();
      const all = await getReportsRepository().getAllDaily();
      setReports(all);
    } catch {
      // Refetch failed too -- leave `reports` alone rather than blank the screen.
    }
  }, []);

  const upsertReport = useCallback(
    async (report: DailyReport) => {
      setReports((prev) => {
        if (!prev) return prev;
        const exists = prev.some((r) => r.id === report.id);
        return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
      });
      try {
        await getReportsRepository().upsert(report);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the report.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  const upsertMany = useCallback(
    async (reports: DailyReport[]) => {
      if (reports.length === 0) return;
      setReports((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of reports) byId.set(r.id, r);
        return [...byId.values()];
      });
      try {
        await getReportsRepository().upsertMany(reports);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the reports.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /** Post-review fix (SHOULD-FIX 14) -- see useReports.ts's `updateReportFields` doc comment for the full rationale (identical here, mirrored for dailies). */
  const updateReportFields = useCallback(
    async (id: string, patch: Partial<DailyReport>) => {
      const fullPatch: Partial<DailyReport> = { ...patch, updatedAt: nowDate() };
      setReports((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...fullPatch } : r)) : prev));
      try {
        const result = await getReportsRepository().update(id, fullPatch);
        if (result === null) {
          throw new Error('This report no longer exists -- it may have been deleted elsewhere.');
        }
        setReports((prev) => (prev ? prev.map((r) => (r.id === id ? (result as DailyReport) : r)) : prev));
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save changes.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /** Phase 8d (report delete): NON-optimistic -- see `useReports.ts`'s `deleteReport` doc comment for the full rationale (identical here, mirrored for dailies). */
  const deleteReport = useCallback(async (id: string) => {
    try {
      await getReportsRepository().deleteReport(id);
      setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      setMutationError(null);
    } catch (err) {
      setMutationError(errorMessage(err, 'Failed to delete the report.'));
      throw err;
    }
  }, []);

  return { reports, loadError, mutationError, upsertReport, upsertMany, updateReportFields, deleteReport };
}
