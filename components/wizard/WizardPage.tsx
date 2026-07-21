'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { WizardScreen } from '@/components/wizard/WizardScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import type { AnyReport, ReportKind } from '@/lib/types';

export interface WizardPageProps {
  /** Absent for a brand-new blank draft (/reports/new, /daily/new); a report id to resume (/reports/:id/edit, /daily/:id/edit). */
  reportId?: string;
  /** Phase 4: which wizard this route mount is -- defaults to 'weekly' so every pre-Phase-4 call site (`/reports/new`, `/reports/:id/edit`) keeps working unchanged. */
  kind?: ReportKind;
}

/**
 * Route-level orchestration for `/reports/new`, `/reports/[id]/edit`,
 * `/daily/new`, and `/daily/[id]/edit` (Phase 4 added the latter two via
 * the `kind` prop). Loads reports itself (per-route, per the plan), resolves
 * the initial draft, and hosts the Share dialog used by the wizard's
 * publish-confirmation screen ("Copy Share Link"). "Download PDF" on that
 * screen is the real print flow now -- it opens `/reports/[id]/present
 * ?print=1` (or `/daily/[id]/present?print=1`) in a new tab (see
 * ReportDeck/PresentScreen, Phase 2) rather than a mocked dialog. An unknown
 * `reportId` redirects to `/` (weekly) or `/daily` (daily) instead of
 * falling through to a blank wizard (parity with the prototype's
 * resumeDraft no-op-on-missing-id behavior).
 *
 * Both `useReports()` and `useDailyReports()` are always called (rules of
 * hooks): the weekly wizard needs the full dailies list anyway, for its
 * "Import This Week's Daily Reports" panel; the daily wizard only reads its
 * own dailies list twice over (as `reports` for carry-forward AND as the
 * one-daily-per-day uniqueness source), which is harmless.
 *
 * Phase 6a: also calls `useProjects()` and passes the list straight through
 * to `WizardScreen`/`useWizard` -- client-field datalist suggestions and the
 * client -> projectId stamp (see `useWizard.updateTask`/`updateRisk`). Not
 * part of the `loaded` gate below: an empty `projects` list while it's still
 * loading just means no suggestions/stamping for a moment, never a blocked
 * render (unlike `weeklyReports`/`dailyReports`, which the wizard cannot
 * function without).
 */
export function WizardPage({ reportId, kind = 'weekly' }: WizardPageProps) {
  const router = useRouter();
  const { reports: weeklyReports, upsertReport: upsertWeekly, loadError: weeklyLoadError } = useReports();
  const { reports: dailyReports, upsertReport: upsertDaily, loadError: dailyLoadError } = useDailyReports();
  const { projects } = useProjects();

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

  const sameKindReports: AnyReport[] | null = kind === 'daily' ? dailyReports : weeklyReports;
  const loaded = kind === 'weekly' ? weeklyReports !== null && dailyReports !== null : dailyReports !== null;
  // Post-review hardening round 2 (SHOULD-FIX H): mirrors `loaded`'s own
  // kind-conditional shape -- the weekly wizard depends on BOTH hooks (the
  // dailies list feeds "Import This Week's Daily Reports"), so either
  // hook's load failure should block it; the daily wizard only depends on
  // `useDailyReports()`, so a weekly-load failure elsewhere shouldn't block
  // it here.
  const loadError = kind === 'weekly' ? (weeklyLoadError ?? dailyLoadError) : dailyLoadError;

  const found = reportId && sameKindReports ? (sameKindReports.find((r) => r.id === reportId) ?? null) : null;
  const notFound = Boolean(reportId) && sameKindReports !== null && found === null;

  // Nav IA restructure: the weekly list moved from `/` to `/reports`, so the
  // weekly wizard's Exit / unknown-id redirect targets the list, not Home.
  const exitHref = kind === 'daily' ? '/daily' : '/reports';

  useEffect(() => {
    if (notFound) router.replace(exitHref);
  }, [notFound, router, exitHref]);

  const exitWizard = () => router.push(exitHref);

  // Phase 7b: returns the underlying hook promise -- useWizard's saveDraft()
  // awaits it and surfaces a rejection through the wizard's `error` channel
  // instead of exiting. Exiting only on success is the whole point: a
  // failed save should leave the user on the wizard with the draft intact,
  // not silently drop them back on the dashboard.
  const handleSaveDraft = async (report: AnyReport) => {
    if (report.kind === 'weekly') await upsertWeekly(report);
    else await upsertDaily(report);
    exitWizard();
  };

  // Publish stays on the wizard's confirmation screen; the user exits via
  // "Back to Dashboard". The report is upserted immediately so Share/PDF on
  // the confirmation screen can resolve it straight from `reports`. Phase
  // 7b: returns the underlying hook promise -- useWizard's publish() only
  // flips to the confirmation screen after this resolves (see that file's
  // doc comment); a rejection propagates back up for the wizard's `error`
  // channel to surface.
  const handlePublish = async (report: AnyReport) => {
    if (report.kind === 'weekly') await upsertWeekly(report);
    else await upsertDaily(report);
  };

  const openShare = (id: string) => {
    setShareReportId(id);
    setShareCopied(false);
    setShareOpen(true);
  };
  const closeShare = () => setShareOpen(false);
  const copyShareLink = () => {
    const link = shareLinkFor(shareReportId, kind);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setShareCopied(true);
    if (shareCopyTimeoutRef.current) clearTimeout(shareCopyTimeoutRef.current);
    shareCopyTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800);
  };

  const openPdf = (id: string) => {
    const base = kind === 'daily' ? '/daily' : '/reports';
    window.open(`${base}/${id}/present?print=1`, '_blank', 'noopener,noreferrer');
  };

  // Post-review hardening round 2 (SHOULD-FIX H): see DashboardPage.tsx's
  // identical guard for the full rationale.
  if (!loaded && loadError) {
    return <LoadErrorState title={kind === 'daily' ? 'Daily Report' : 'Report'} message={loadError} />;
  }

  // Reports haven't loaded yet, or a reportId lookup is still pending the
  // redirect effect above: render nothing rather than a flash of a blank
  // wizard.
  if (!loaded || notFound) return null;

  const initialReport = found ? structuredClone(found) : null;

  return (
    <>
      <WizardScreen
        key={reportId ?? 'new'}
        kind={kind}
        reports={sameKindReports ?? []}
        dailies={kind === 'weekly' ? (dailyReports ?? []) : undefined}
        projects={projects ?? []}
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
        kind={kind}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={closeShare}
      />
    </>
  );
}
