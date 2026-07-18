'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { PdfDialog } from '@/components/dialogs/PdfDialog';
import { ReportDetailDialog } from '@/components/dialogs/ReportDetailDialog';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { useReports } from '@/lib/hooks/useReports';
import type { SortKey } from '@/lib/types';

/**
 * Route-level orchestration for `/` (the dashboard). Owns filter/sort/search
 * /pagination state (resets on navigation away and back -- acceptable, see
 * plan) and hosts the Detail/Share/Pdf dialogs. Navigation to the wizard
 * goes through real routes instead of a view-switcher (see the retired
 * WeeklyReportsApp).
 */
export function DashboardPage() {
  const router = useRouter();
  const { reports, updateReportFields } = useReports();

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

  const [detailReportId, setDetailReportId] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareReportId, setShareReportId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfReportId, setPdfReportId] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    },
    []
  );

  const openDetail = (id: string) => setDetailReportId(id);
  const closeDetail = () => setDetailReportId(null);

  const openShare = (id: string) => {
    setShareReportId(id);
    setShareCopied(false);
    setShareOpen(true);
  };
  const openShareFromDetail = () => {
    if (detailReportId) openShare(detailReportId);
  };
  const closeShare = () => setShareOpen(false);
  const copyShareLink = () => {
    const link = shareLinkFor(shareReportId);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setShareCopied(true);
    if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    shareCopyTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800);
  };

  const openPdf = (id: string) => {
    setPdfReportId(id);
    setPdfOpen(true);
  };
  const openPdfFromDetail = () => {
    if (detailReportId) openPdf(detailReportId);
  };
  const closePdf = () => setPdfOpen(false);

  // Reports haven't loaded yet: server HTML and the first client render both
  // render nothing here, so there is no hydration mismatch (see useReports).
  if (reports === null) return null;

  const detailReport = reports.find((r) => r.id === detailReportId) ?? null;
  const pdfReport = reports.find((r) => r.id === pdfReportId) ?? null;

  return (
    <>
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
        onViewReport={openDetail}
      />

      <ReportDetailDialog
        report={detailReport}
        open={detailReportId !== null}
        onClose={closeDetail}
        onUpdateFields={(patch) => {
          if (detailReportId) updateReportFields(detailReportId, patch);
        }}
        onShare={openShareFromDetail}
        onPdf={openPdfFromDetail}
      />

      <ShareDialog
        open={shareOpen}
        reportId={shareReportId}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={closeShare}
      />

      <PdfDialog open={pdfOpen} report={pdfReport} onClose={closePdf} />
    </>
  );
}
