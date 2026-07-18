'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { nowDate } from '../format';
import type { Report } from '../types';

export interface UseReportsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  reports: Report[] | null;
  /** Optimistic local update + fire-and-forget persistence. */
  upsertReport: (report: Report) => void;
  /**
   * Phase 6b: batch sibling of `upsertReport` -- ONE repository write for
   * the whole array (see `ReportsRepository.upsertMany`'s doc comment for
   * why N separate `upsertReport` calls is NOT safe for a same-tick batch).
   * Returns a Promise that resolves once the repository write completes, so
   * a caller committing a MIXED batch (e.g. the CSV importer, which also
   * has dailies to write via `useDailyReports().upsertMany`) can `await`
   * this call before starting the next one -- that sequencing, not a single
   * combined call, is what keeps the two kind-specific batches from racing
   * each other's `loadAll()`/write.
   */
  upsertMany: (reports: Report[]) => Promise<void>;
  /** Shallow-merges `patch` (plus a fresh `updatedAt`) into the report with `id`. */
  updateReportFields: (id: string, patch: Partial<Report>) => void;
}

export function useReports(): UseReportsResult {
  const [reports, setReports] = useState<Report[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReportsRepository()
      .getAll()
      .then((all) => {
        if (!cancelled) setReports(all);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertReport = useCallback((report: Report) => {
    setReports((prev) => {
      if (!prev) return prev;
      const exists = prev.some((r) => r.id === report.id);
      return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
    });
    void getReportsRepository().upsert(report);
  }, []);

  const upsertMany = useCallback(async (reports: Report[]) => {
    if (reports.length === 0) return;
    setReports((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of reports) byId.set(r.id, r);
      return [...byId.values()];
    });
    await getReportsRepository().upsertMany(reports);
  }, []);

  const updateReportFields = useCallback((id: string, patch: Partial<Report>) => {
    const fullPatch: Partial<Report> = { ...patch, updatedAt: nowDate() };
    setReports((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...fullPatch } : r)) : prev));
    void getReportsRepository().update(id, fullPatch);
  }, []);

  return { reports, upsertReport, upsertMany, updateReportFields };
}
