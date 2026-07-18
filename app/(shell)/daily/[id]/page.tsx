'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReportScreen } from '@/components/report/ReportScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { invalidDailyDateEdit } from '@/lib/report-utils';
import type { ReportFieldPatch } from '@/lib/types';

/**
 * `/daily/[id]` -- the full daily report screen, inside the sidebar shell.
 * Mirrors `app/(shell)/reports/[id]/page.tsx`, but over
 * `useDailyReports()` and with `kind="daily"` passed to the shared
 * `ReportScreen`. An unknown id redirects to `/daily`.
 *
 * Phase 4 fix: this screen's Date field autosaves through `onUpdateFields`
 * straight to `updateReportFields` -> the repository, bypassing the
 * wizard's step-1 validation entirely -- so the one-daily-per-day
 * invariant (`reports_one_daily_per_day` in SQL) has to be re-checked
 * here, the one other place a daily's `date` can change. A blank or
 * colliding edit is rejected before it ever reaches `updateReportFields`
 * (the controlled Date input in ReportScreen then simply reverts to the
 * still-current `report.date` on the next render, since nothing changed);
 * `dateError` surfaces why.
 *
 * Phase 6a: the collision check is scoped per project bucket
 * (`report?.projectId ?? null` -- `sameProjectBucket` in lib/report-utils.ts),
 * so a same-date daily belonging to a different (imported) project no longer
 * blocks this edit; a house daily (`projectId` unset) still collides with
 * another house daily on the same date exactly as before.
 */
export default function DailyReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports, updateReportFields } = useDailyReports();
  const [dateError, setDateError] = useState('');

  const id = params.id;
  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

  useEffect(() => {
    if (notFound) router.replace('/daily');
  }, [notFound, router]);

  const handleUpdateFields = (patch: ReportFieldPatch) => {
    if (!id) return;
    if (patch.date !== undefined && invalidDailyDateEdit(reports ?? [], id, patch.date, report?.projectId ?? null)) {
      setDateError(patch.date ? 'A daily report for this date already exists.' : 'Enter a report date.');
      return;
    }
    setDateError('');
    updateReportFields(id, patch);
  };

  // Reports haven't loaded yet, or the not-found redirect above is pending:
  // render nothing rather than a flash of an empty report screen.
  if (reports === null || notFound) return null;

  return <ReportScreen report={report} kind="daily" dateError={dateError} onUpdateFields={handleUpdateFields} />;
}
