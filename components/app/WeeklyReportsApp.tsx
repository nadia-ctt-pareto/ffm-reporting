'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { PdfDialog } from '@/components/dialogs/PdfDialog';
import { ReportDetailDialog } from '@/components/dialogs/ReportDetailDialog';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { WizardScreen } from '@/components/wizard/WizardScreen';
import { useReports } from '@/lib/hooks/useReports';
import type { Report, SortKey } from '@/lib/types';

type View = 'dashboard' | 'wizard';

/** Line 722 (rootStyle), fonts swapped for the next/font CSS variables. */
function rootStyle(darkMode: boolean): CSSProperties {
  return {
    minHeight: '100vh',
    background: darkMode ? '#0A0A0A' : '#FFFFFF',
    color: darkMode ? '#FFFFFF' : '#0A0A0A',
    fontFamily: 'var(--font-body)',
    transition: 'background var(--speed-med) var(--ease-brand), color var(--speed-med) var(--ease-brand)',
  };
}

export function WeeklyReportsApp() {
  const { reports, upsertReport, updateReportFields } = useReports();

  const [view, setView] = useState<View>('dashboard');
  const [darkMode, setDarkMode] = useState(false);

  const [filterStatus, setFilterStatus] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('week_desc');

  const [detailReportId, setDetailReportId] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareReportId, setShareReportId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfReportId, setPdfReportId] = useState<string | null>(null);

  // The report (if any) "New Report"/"Continue" was invoked from. null means
  // a brand-new blank draft; a Report means resuming that draft.
  const [wizardInitial, setWizardInitial] = useState<Report | null>(null);
  // Bumped on every openNewReport/resumeDraft so <WizardScreen key={wizardKey}>
  // always remounts with fresh internal state -- resume/new never shows a
  // stale draft even if the wizard were somehow already mounted.
  const [wizardKey, setWizardKey] = useState(0);

  useEffect(
    () => () => {
      if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    },
    []
  );

  // ---- navigation (lines 522-528) ----
  const openNewReport = () => {
    setWizardInitial(null);
    setWizardKey((k) => k + 1);
    setView('wizard');
  };

  const resumeDraft = (id: string) => {
    const found = reports?.find((r) => r.id === id) ?? null;
    // Parity with prototype resumeDraft (line 523): a missing id is a no-op,
    // not a fall-through into a blank New Report wizard.
    if (!found) return;
    // Deep clone so editing the draft in the wizard never mutates the
    // persisted report until saveDraft/publish explicitly writes it back.
    setWizardInitial(structuredClone(found));
    setWizardKey((k) => k + 1);
    setView('wizard');
  };

  const exitWizard = () => {
    setView('dashboard');
    setWizardInitial(null);
  };

  // ---- wizard persistence (lines 542-553) ----
  const handleWizardSaveDraft = (report: Report) => {
    upsertReport(report);
    exitWizard();
  };

  // Publish stays on the wizard's confirmation screen; the user exits via
  // "Back to Dashboard". The report is upserted immediately so Share/PDF on
  // the confirmation screen can resolve it straight from `reports`.
  const handleWizardPublish = (report: Report) => {
    upsertReport(report);
  };

  // ---- detail dialog (lines 613-619) ----
  const openDetail = (id: string) => setDetailReportId(id);
  const closeDetail = () => setDetailReportId(null);

  // ---- share (lines 622-629) ----
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

  // ---- pdf (lines 630-632) ----
  const openPdf = (id: string) => {
    setPdfReportId(id);
    setPdfOpen(true);
  };
  const openPdfFromDetail = () => {
    if (detailReportId) openPdf(detailReportId);
  };
  const closePdf = () => setPdfOpen(false);

  // Reports haven't loaded yet: server HTML and the first client render both
  // show this shell, so there is no hydration mismatch (see useReports).
  if (reports === null) {
    return <div style={rootStyle(darkMode)} />;
  }

  const detailReport = reports.find((r) => r.id === detailReportId) ?? null;
  const pdfReport = reports.find((r) => r.id === pdfReportId) ?? null;

  return (
    <div style={rootStyle(darkMode)}>
      {view === 'dashboard' ? (
        <DashboardScreen
          reports={reports}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((v) => !v)}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          filterClient={filterClient}
          onFilterClientChange={setFilterClient}
          search={search}
          onSearchChange={setSearch}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          onNewReport={openNewReport}
          onResumeDraft={resumeDraft}
          onViewReport={openDetail}
        />
      ) : (
        <WizardScreen
          key={wizardKey}
          reports={reports}
          initialReport={wizardInitial}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((v) => !v)}
          onExit={exitWizard}
          onSaveDraft={handleWizardSaveDraft}
          onPublish={handleWizardPublish}
          onShareForPublished={openShare}
          onPdfForPublished={openPdf}
        />
      )}

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
    </div>
  );
}
