'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { nowDate } from '../format';
import type { DailyReport } from '../types';

/**
 * Phase 4: the daily-report sibling of useReports.ts -- identical
 * optimistic-update pattern, but reads/writes DailyReport[] via
 * `getReportsRepository().getAllDaily()`. Still only ever goes through
 * `getReportsRepository()`, never a concrete repository class.
 */
export interface UseDailyReportsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  reports: DailyReport[] | null;
  /** Optimistic local update + fire-and-forget persistence. */
  upsertReport: (report: DailyReport) => void;
  /** Shallow-merges `patch` (plus a fresh `updatedAt`) into the report with `id`. */
  updateReportFields: (id: string, patch: Partial<DailyReport>) => void;
}

export function useDailyReports(): UseDailyReportsResult {
  const [reports, setReports] = useState<DailyReport[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReportsRepository()
      .getAllDaily()
      .then((all) => {
        if (!cancelled) setReports(all);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertReport = useCallback((report: DailyReport) => {
    setReports((prev) => {
      if (!prev) return prev;
      const exists = prev.some((r) => r.id === report.id);
      return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
    });
    void getReportsRepository().upsert(report);
  }, []);

  const updateReportFields = useCallback((id: string, patch: Partial<DailyReport>) => {
    const fullPatch: Partial<DailyReport> = { ...patch, updatedAt: nowDate() };
    setReports((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...fullPatch } : r)) : prev));
    void getReportsRepository().update(id, fullPatch);
  }, []);

  return { reports, upsertReport, updateReportFields };
}
