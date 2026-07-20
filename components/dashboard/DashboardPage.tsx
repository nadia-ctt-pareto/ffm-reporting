'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import type { SortKey } from '@/lib/types';

/**
 * Route-level orchestration for `/` (the dashboard). Owns filter/sort/search
 * /pagination state (resets on navigation away and back -- acceptable, see
 * plan). "View" navigates to the real `/reports/[id]` report screen (Phase
 * 2) instead of opening a Detail dialog -- there's no dialog hosting left
 * here; Share now lives on the report screen itself (see ReportScreen),
 * and PDF export is the real browser print flow at `/reports/[id]/present`.
 */
export function DashboardPage() {
  const router = useRouter();
  const { reports, loadError } = useReports();
  const { projects } = useProjects();

  const [filterStatus, setFilterStatus] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('week_desc');
  const [pageSize, setPageSize] = useState<string>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

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

  return (
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
    />
  );
}
