'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReportScreen } from '@/components/report/ReportScreen';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/reports/[id]` -- the full report screen, inside the sidebar shell.
 * Loads reports itself and resolves `id` via `useParams()`: this route is
 * small enough (one param, one hook, no dialog hosting -- ReportScreen owns
 * its own tiny Share-dialog state) that it doesn't need a separate
 * route-level orchestrator like DashboardPage/WizardPage. An unknown id
 * redirects to `/`, matching WizardPage's resumeDraft parity.
 */
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { reports, updateReportFields } = useReports();

  const id = params.id;
  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

  useEffect(() => {
    if (notFound) router.replace('/');
  }, [notFound, router]);

  // Reports haven't loaded yet, or the not-found redirect above is pending:
  // render nothing rather than a flash of an empty report screen.
  if (reports === null || notFound) return null;

  return (
    <ReportScreen
      report={report}
      kind="weekly"
      onUpdateFields={(patch) => {
        if (id) updateReportFields(id, patch);
      }}
    />
  );
}
