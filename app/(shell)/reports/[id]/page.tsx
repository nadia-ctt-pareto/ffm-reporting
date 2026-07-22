'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ReportScreen } from '@/components/report/ReportScreen';
import { useReports } from '@/lib/hooks/useReports';
import { useSession } from '@/lib/hooks/useSession';
import { canDeleteReport, canEditReport, DELETE_REPORT_HINT, EDIT_REPORT_HINT } from '@/lib/report-access';
import { isSupabaseConfigured } from '@/lib/supabase/config';
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
 *
 * Phase 8d (report delete): the owner-or-admin gate is NOT computed here -- it lives in
 * `canDeleteReport` (lib/report-access.ts), shared verbatim with the daily
 * report screen and both list pages, so four call sites cannot drift apart
 * on an access rule (the same reason `resolveNewProjectName` was extracted
 * in Phase 8c). See that function's doc comment for why the obvious inline
 * expression is wrong: `undefined === undefined` is `true`, so an unowned
 * seed row compared against a not-yet-resolved session enabled Delete for a
 * user who cannot delete. `ownerId` is already broadcast on every
 * `AnyReport` (`ReportCoreSchema.ownerId`, lib/schema/report.ts) to every
 * authenticated user -- see that field's own doc comment -- so no
 * read-schema change was needed to compute this client-side.
 *
 * That gate is UX only; `reports_delete` RLS is the actual boundary and
 * rejects a non-owner regardless of what this page renders.
 *
 * `deleteReport` itself is NON-optimistic (see useReports.ts) -- `notFound`
 * below (derived from the same `reports` state it mutates) is what redirects
 * away after a successful delete; `ReportScreen`'s own confirm dialog never
 * navigates.
 */
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports, loadError, updateReportFields, deleteReport, mutationError } = useReports();
  const { user, loading: sessionLoading } = useSession();
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

  // Phase 8d (report delete): see this component's own doc comment above for the full
  // owner-or-admin rationale -- this line is the entire gate.
  const canDelete = canDeleteReport(report, {
    user,
    loading: sessionLoading,
    supabaseConfigured: isSupabaseConfigured(),
  });

  // WP3 (the access flip): owner-only, no pm/admin branch -- see
  // `canEditReport`'s doc comment (lib/report-access.ts). Gates ReportScreen's
  // inline status/preparedFor/period autosave AND its "Edit Report" wizard
  // entry point.
  const canEdit = canEditReport(report, {
    user,
    loading: sessionLoading,
    supabaseConfigured: isSupabaseConfigured(),
  });

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (reports === null && loadError) return <LoadErrorState title="Report" message={loadError} />;

  // Reports haven't loaded yet, or the not-found redirect above is pending:
  // render nothing rather than a flash of an empty report screen.
  if (reports === null || notFound) return null;

  return (
    <ReportScreen
      report={report}
      kind="weekly"
      periodError={periodError}
      mutationError={mutationError}
      onUpdateFields={handleUpdateFields}
      onDelete={() => deleteReport(id)}
      canDelete={canDelete}
      deleteHint={DELETE_REPORT_HINT}
      canEdit={canEdit}
      editHint={EDIT_REPORT_HINT}
    />
  );
}
