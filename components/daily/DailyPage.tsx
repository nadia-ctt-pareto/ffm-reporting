'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ConfirmDeleteReportDialog } from '@/components/dialogs/ConfirmDeleteReportDialog';
import { DailyListScreen } from '@/components/daily/DailyListScreen';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useSession } from '@/lib/hooks/useSession';
import { canDeleteReport } from '@/lib/report-access';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { DailyReport } from '@/lib/types';

/**
 * Route-level orchestration for `/daily` -- the daily-report sibling of
 * `components/dashboard/DashboardPage.tsx`. Owns filter/pagination state
 * locally (resets on navigation away and back -- acceptable, same rationale
 * as DashboardPage). "View"/"Continue" navigate to real routes
 * (`/daily/[id]`, `/daily/[id]/edit`), not a dialog.
 *
 * Phase 8d (report delete): also hosts the shared delete-confirmation dialog for the row-level
 * Delete button -- see `DashboardPage.tsx`'s identical doc comment for the
 * full rationale (mirrored here, over `useDailyReports()`).
 */
export function DailyPage() {
  const router = useRouter();
  const { reports, loadError, deleteReport } = useDailyReports();
  const { user, loading: sessionLoading } = useSession();

  const [filterStatus, setFilterStatus] = useState('All');
  const [pageSize, setPageSize] = useState<string>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reset to page 1 whenever any filter/page-size input changes -- never
  // leaves the user stranded on a now-out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [filterStatus, pageSize]);

  // Reports haven't loaded yet: server HTML and the first client render both
  // render nothing here, so there is no hydration mismatch (see useDailyReports).
  // Post-review fix (SHOULD-FIX 11) -- see DashboardPage.tsx's identical guard for the full rationale.
  if (reports === null) {
    if (loadError) return <LoadErrorState title="Daily Reports" message={loadError} />;
    return null;
  }

  // Phase 8d (report delete): see DashboardPage.tsx's identical gate for the full rationale.
  const deletable = (report: DailyReport): boolean =>
    canDeleteReport(report, { user, loading: sessionLoading, supabaseConfigured: isSupabaseConfigured() });

  const pendingDeleteReport = reports.find((r) => r.id === pendingDeleteId) ?? null;

  const closeDeleteDialog = () => {
    setPendingDeleteId(null);
    setDeleteError(null);
  };

  /** Phase 8d: mirrors `DashboardPage.tsx`'s identical `handleConfirmDelete` -- no navigation on success, and `isDeleting` reset in BOTH branches (see that file's doc comment for why this list page must diverge from the ReportScreen/ProjectDetailScreen precedent it otherwise copies). */
  const handleConfirmDelete = async () => {
    if (!pendingDeleteId || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteReport(pendingDeleteId);
      setPendingDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the report.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <DailyListScreen
        reports={reports}
        filterStatus={filterStatus}
        onFilterStatusChange={setFilterStatus}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        page={page}
        onPageChange={setPage}
        onNewDaily={() => router.push('/daily/new')}
        onResumeDraft={(id) => router.push(`/daily/${id}/edit`)}
        onViewReport={(id) => router.push(`/daily/${id}`)}
        onDeleteReport={setPendingDeleteId}
        canDeleteReport={deletable}
      />
      {/* `open` is keyed off the resolved REPORT, not the pending id: if the
          row disappears from under an open dialog (deleted in another tab, or
          filtered away by a concurrent refresh), `pendingDeleteReport` goes
          null while `pendingDeleteId` is still set -- which rendered the
          dialog with an empty period and the wrong default kind label
          ("Weekly Report" even on the daily page). Closing is the honest
          outcome; there is nothing left to confirm. */}
      <ConfirmDeleteReportDialog
        open={pendingDeleteReport !== null}
        report={pendingDeleteReport}
        isDeleting={isDeleting}
        error={deleteError}
        onCancel={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
