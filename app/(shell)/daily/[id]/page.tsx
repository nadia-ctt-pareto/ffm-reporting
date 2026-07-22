'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ReportScreen } from '@/components/report/ReportScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useSession } from '@/lib/hooks/useSession';
import { canDeleteReport, DELETE_REPORT_HINT } from '@/lib/report-access';
import { invalidDailyDateEdit } from '@/lib/report-utils';
import { isSupabaseConfigured } from '@/lib/supabase/config';
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
 * `periodError` surfaces why (ReportScreen's `dateError` prop was renamed
 * `periodError` in Phase 7b so the weekly report screen's analogous
 * blank-Week-Start/End guard, app/(shell)/reports/[id]/page.tsx, could
 * reuse the same prop -- see that prop's doc comment).
 *
 * Phase 6a: the collision check is scoped per project bucket
 * (`report?.projectId ?? null` -- `sameProjectBucket` in lib/report-utils.ts),
 * so a same-date daily belonging to a different (imported) project no longer
 * blocks this edit; a house daily (`projectId` unset) still collides with
 * another house daily on the same date exactly as before.
 *
 * Phase 8d (report delete): `canDelete` mirrors `app/(shell)/reports/[id]/page.tsx`'s
 * identical gate byte-for-byte (owner-or-admin, matching `reports_delete`
 * RLS; unconditionally `true` in demo mode) -- see that file's own doc
 * comment for the full rationale, including why no read-schema change was
 * needed for `report.ownerId`.
 */
export default function DailyReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports, loadError, updateReportFields, deleteReport, mutationError } = useDailyReports();
  const { user, loading: sessionLoading } = useSession();
  const [periodError, setPeriodError] = useState('');

  const id = params.id;
  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

  useEffect(() => {
    if (notFound) router.replace('/daily');
  }, [notFound, router]);

  const handleUpdateFields = (patch: ReportFieldPatch) => {
    if (!id) return;
    if (patch.date !== undefined && invalidDailyDateEdit(reports ?? [], id, patch.date, report?.projectId ?? null)) {
      setPeriodError(patch.date ? 'A daily report for this date already exists.' : 'Enter a report date.');
      return;
    }
    setPeriodError('');
    updateReportFields(id, patch).catch(() => {});
  };

  // Phase 8d (report delete): see this component's own doc comment above for the full
  // owner-or-admin rationale -- this line is the entire gate.
  const canDelete = canDeleteReport(report, {
    user,
    loading: sessionLoading,
    supabaseConfigured: isSupabaseConfigured(),
  });

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (reports === null && loadError) return <LoadErrorState title="Daily Report" message={loadError} />;

  // Reports haven't loaded yet, or the not-found redirect above is pending:
  // render nothing rather than a flash of an empty report screen.
  if (reports === null || notFound) return null;

  return (
    <ReportScreen
      report={report}
      kind="daily"
      periodError={periodError}
      mutationError={mutationError}
      onUpdateFields={handleUpdateFields}
      onDelete={() => deleteReport(id)}
      canDelete={canDelete}
      deleteHint={DELETE_REPORT_HINT}
    />
  );
}
