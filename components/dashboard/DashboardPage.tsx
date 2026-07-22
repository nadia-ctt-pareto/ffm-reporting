'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ConfirmDeleteReportDialog } from '@/components/dialogs/ConfirmDeleteReportDialog';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import { useSession } from '@/lib/hooks/useSession';
import { canDeleteReport, canEditReport } from '@/lib/report-access';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { Report, SortKey } from '@/lib/types';

/**
 * Route-level orchestration for `/` (the dashboard). Owns filter/sort/search
 * /pagination state (resets on navigation away and back -- acceptable, see
 * plan). "View" navigates to the real `/reports/[id]` report screen (Phase
 * 2) instead of opening a Detail dialog; Share lives on the report screen
 * itself (see ReportScreen), and PDF export is the real browser print flow
 * at `/reports/[id]/present`.
 *
 * Phase 8d (report delete): this IS where a dialog gets hosted again -- the row-level Delete
 * button (`DashboardScreen`'s new `onDeleteReport`/`canDeleteReport` props)
 * has no per-row component of its own to own confirm/isDeleting/error
 * state, so it lands here, at the route-orchestrator level, the same place
 * every other list-level dialog in this codebase has always lived (this
 * screen just hadn't needed one since Phase 5 deleted the old Detail/Pdf
 * dialogs). `canDeleteReport` mirrors `app/(shell)/reports/[id]/page.tsx`'s
 * `canDelete` gate exactly (owner-or-admin via the same `useSession()`
 * read, unconditionally `true` in demo mode) -- see that file's own doc
 * comment for the full rationale.
 */
export function DashboardPage() {
  const router = useRouter();
  const { reports, loadError, deleteReport } = useReports();
  const { projects } = useProjects();
  const { user, loading: sessionLoading } = useSession();

  const [filterStatus, setFilterStatus] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('week_desc');
  const [pageSize, setPageSize] = useState<string>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reset to page 1 whenever any filter/sort/page-size input changes --
  // never leaves the user stranded on a now-out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterClient, search, sortBy, pageSize]);

  // Reports haven't loaded yet: server HTML and the first client render both
  // render nothing here, so there is no hydration mismatch (see useReports).
  // Post-review fix (SHOULD-FIX 11): a FAILED initial load also leaves
  // `reports === null` forever -- `loadError` distinguishes "still loading"
  // from "loading failed" and gets a real, actionable screen instead of a
  // permanent blank pane.
  if (reports === null) {
    if (loadError) return <LoadErrorState title="Dashboard" message={loadError} />;
    return null;
  }

  // Phase 6a: dynamic client filter options, replacing the static
  // CLIENT_FILTER_OPTIONS (FF_CLIENTS remains the client-name source for
  // seedReports()/seedDailyReports() -- see lib/constants.ts). `projects`
  // may still be loading (null) on first paint; `[]` just means the filter
  // briefly offers only 'All', never a blocked render (unlike `reports`).
  // `clientOptions` is a pure <Select> concern -- the "Active Clients" stat
  // is derived from `projects` directly (passed below), NOT from this list's
  // length, so a future second sentinel option (e.g. an 'Unassigned' bucket)
  // can never silently off-by-one that stat.
  const clientOptions = ['All', ...(projects ?? []).map((p) => p.name)];

  // Phase 8d (report delete): the entire owner-or-admin gate, evaluated per row. Bound once here
  // (rather than inline per row) so every row shares one session snapshot --
  // and named `deletable` to avoid shadowing the imported predicate.
  const deletable = (report: Report): boolean =>
    canDeleteReport(report, { user, loading: sessionLoading, supabaseConfigured: isSupabaseConfigured() });

  // WP3 (the access flip): the owner-only edit gate, evaluated per row --
  // decides whether a Draft row's action button is "Continue" (into the
  // wizard's resume flow) or "View" (the read-only report screen). Under
  // scoped reads a pm/admin now legitimately sees teammates' Draft reports
  // in this list; without this gate they'd get a "Continue" button that
  // opens the wizard only to have every save rejected (see
  // `WizardPage`'s own owner-only redirect guard, which would immediately
  // bounce them back out anyway -- this just avoids offering the
  // affordance in the first place).
  const editable = (report: Report): boolean =>
    canEditReport(report, { user, loading: sessionLoading, supabaseConfigured: isSupabaseConfigured() });

  const pendingDeleteReport = reports.find((r) => r.id === pendingDeleteId) ?? null;

  const closeDeleteDialog = () => {
    setPendingDeleteId(null);
    setDeleteError(null);
  };

  /**
   * Phase 8d: no navigation on success -- there is nothing to navigate away
   * FROM here; the row itself just disappears once `deleteReport`'s
   * non-optimistic `setReports` filter lands and this component re-renders.
   *
   * `isDeleting` is reset in BOTH branches, which is where this deliberately
   * DIVERGES from `ReportScreen.handleDelete`/`ProjectDetailScreen
   * .handleDelete`. Those two get away with resetting it only on failure
   * because a successful delete UNMOUNTS them (their route derives `notFound`
   * from the same list and redirects away). This list page does not unmount --
   * only the row goes. So leaving `isDeleting` true on success stranded it
   * true for the life of the page: the next confirm dialog opened with a
   * disabled "Deleting..." button and the `isDeleting` guard on the first line
   * below swallowed every later confirm, making row-level Delete a
   * one-shot-per-page-load feature until a reload. Caught in security review.
   */
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
      <DashboardScreen
        reports={reports}
        clientOptions={clientOptions}
        projects={projects}
        filterStatus={filterStatus}
        onFilterStatusChange={setFilterStatus}
        filterClient={filterClient}
        onFilterClientChange={setFilterClient}
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        page={page}
        onPageChange={setPage}
        onNewReport={() => router.push('/reports/new')}
        onResumeDraft={(id) => router.push(`/reports/${id}/edit`)}
        onViewReport={(id) => router.push(`/reports/${id}`)}
        onDeleteReport={setPendingDeleteId}
        canDeleteReport={deletable}
        canEditReport={editable}
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
