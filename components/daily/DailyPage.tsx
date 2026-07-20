'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { DailyListScreen } from '@/components/daily/DailyListScreen';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { useDailyReports } from '@/lib/hooks/useDailyReports';

/**
 * Route-level orchestration for `/daily` -- the daily-report sibling of
 * `components/dashboard/DashboardPage.tsx`. Owns filter/pagination state
 * locally (resets on navigation away and back -- acceptable, same rationale
 * as DashboardPage). "View"/"Continue" navigate to real routes
 * (`/daily/[id]`, `/daily/[id]/edit`), not a dialog.
 */
export function DailyPage() {
  const router = useRouter();
  const { reports, loadError } = useDailyReports();

  const [filterStatus, setFilterStatus] = useState('All');
  const [pageSize, setPageSize] = useState<string>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

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

  return (
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
    />
  );
}
