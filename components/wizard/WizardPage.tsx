'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { WizardScreen } from '@/components/wizard/WizardScreen';
import { useReports } from '@/lib/hooks/useReports';
import type { Report } from '@/lib/types';

export interface WizardPageProps {
  /** Absent for a brand-new blank draft (/reports/new); a report id to resume (/reports/:id/edit). */
  reportId?: string;
}

/**
 * Route-level orchestration for `/reports/new` and `/reports/[id]/edit`.
 * Loads reports itself (per-route, per the plan), resolves the initial
 * draft, and hosts the Share dialog used by the wizard's
 * publish-confirmation screen ("Copy Share Link"). "Download PDF" on that
 * screen is the real print flow now -- it opens `/reports/[id]/present
 * ?print=1` in a new tab (see ReportDeck/PresentScreen, Phase 2) rather
 * than a mocked dialog. An unknown `reportId` redirects to `/` instead of
 * falling through to a blank wizard (parity with the prototype's
 * resumeDraft no-op-on-missing-id behavior).
 */
export function WizardPage({ reportId }: WizardPageProps) {
  const router = useRouter();
  const { reports, upsertReport } = useReports();

  const [shareOpen, setShareOpen] = useState(false);
  const [shareReportId, setShareReportId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    },
    []
  );

  const found = reportId && reports ? (reports.find((r) => r.id === reportId) ?? null) : null;
  const notFound = Boolean(reportId) && reports !== null && found === null;

  useEffect(() => {
    if (notFound) router.replace('/');
  }, [notFound, router]);

  const exitWizard = () => router.push('/');

  const handleSaveDraft = (report: Report) => {
    upsertReport(report);
    exitWizard();
  };

  // Publish stays on the wizard's confirmation screen; the user exits via
  // "Back to Dashboard". The report is upserted immediately so Share/PDF on
  // the confirmation screen can resolve it straight from `reports`.
  const handlePublish = (report: Report) => {
    upsertReport(report);
  };

  const openShare = (id: string) => {
    setShareReportId(id);
    setShareCopied(false);
    setShareOpen(true);
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
    window.open(`/reports/${id}/present?print=1`, '_blank', 'noopener,noreferrer');
  };

  // Reports haven't loaded yet, or a reportId lookup is still pending the
  // redirect effect above: render nothing rather than a flash of a blank
  // wizard.
  if (reports === null || notFound) return null;

  const initialReport = found ? structuredClone(found) : null;

  return (
    <>
      <WizardScreen
        key={reportId ?? 'new'}
        reports={reports}
        initialReport={initialReport}
        onExit={exitWizard}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onShareForPublished={openShare}
        onPdfForPublished={openPdf}
      />

      <ShareDialog
        open={shareOpen}
        reportId={shareReportId}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={closeShare}
      />
    </>
  );
}
