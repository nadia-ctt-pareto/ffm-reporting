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

  const updateReportFields = useCallback((id: string, patch: Partial<Report>) => {
    const fullPatch: Partial<Report> = { ...patch, updatedAt: nowDate() };
    setReports((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...fullPatch } : r)) : prev));
    void getReportsRepository().update(id, fullPatch);
  }, []);

  return { reports, upsertReport, updateReportFields };
}
