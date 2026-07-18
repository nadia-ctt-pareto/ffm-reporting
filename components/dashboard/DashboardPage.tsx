'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
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
  const { reports } = useReports();

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
  if (reports === null) return null;

  return (
    <DashboardScreen
      reports={reports}
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
