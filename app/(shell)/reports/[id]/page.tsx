'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ReportScreen } from '@/components/report/ReportScreen';
import { useReports } from '@/lib/hooks/useReports';
import type { ReportFieldPatch } from '@/lib/types';

/**
 * `/reports/[id]` -- the full report screen, inside the sidebar shell.
 * Loads reports itself and resolves `id` via `useParams()`: this route is
 * small enough (one param, one hook, no dialog hosting -- ReportScreen owns
 * its own tiny Share-dialog state) that it doesn't need a separate
 * route-level orchestrator like DashboardPage/WizardPage. An unknown id
 * redirects to `/reports` (the weekly list), matching WizardPage's
 * resumeDraft parity.
 *
 * BLOCKER 2 fix (second half, Phase 7b): a weekly report's Week Start/Week
 * End are non-nullable `isoDate` fields in the Supabase schema
 * (`ReportPatchSchema`, lib/schema/api.ts) -- clearing either
 * `<input type="date">` on ReportScreen sends `{ weekStart: '' }`/
 * `{ weekEnd: '' }` straight to `onUpdateFields`, which used to reach
 * `updateReportFields` -> `PATCH /api/reports/[id]` -> a raw 400. Rejected
 * here instead, same pattern as the daily report screen's
 * `invalidDailyDateEdit` guard (app/(shell)/daily/[id]/page.tsx) -- the
 * controlled `<input>` simply reverts to the still-current value on the
 * next render since nothing changed; `periodError` surfaces why.
 */
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports, loadError, updateReportFields, mutationError } = useReports();
  const [periodError, setPeriodError] = useState('');

  const id = params.id;
  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

  useEffect(() => {
    if (notFound) router.replace('/reports');
  }, [notFound, router]);

  const handleUpdateFields = (patch: ReportFieldPatch) => {
    if (!id) return;
    if ((patch.weekStart !== undefined && !patch.weekStart) || (patch.weekEnd !== undefined && !patch.weekEnd)) {
      setPeriodError('Week Start and Week End cannot be blank.');
      return;
    }
    setPeriodError('');
    updateReportFields(id, patch).catch(() => {});
  };

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (reports === null && loadError) return <LoadErrorState title="Report" message={loadError} />;

  // Reports haven't loaded yet, or the not-found redirect above is pending:
  // render nothing rather than a flash of an empty report screen.
  if (reports === null || notFound) return null;

  return (
    <ReportScreen report={report} kind="weekly" periodError={periodError} mutationError={mutationError} onUpdateFields={handleUpdateFields} />
  );
}
