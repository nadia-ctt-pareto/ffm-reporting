'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { ShareDialog, shareLinkFor } from '@/components/dialogs/ShareDialog';
import { WizardScreen } from '@/components/wizard/WizardScreen';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import { useSession } from '@/lib/hooks/useSession';
import { useTeamMembers } from '@/lib/hooks/useTeamMembers';
import { canEditReport } from '@/lib/report-access';
import { isSupabaseConfigured } from '@/lib/supabase/config';
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
 *
 * WP2: also calls `useTeamMembers()` and passes the list through to
 * `WizardScreen` -> `StepTasks`' Assignee `<Select>` -- same "not part of
 * the `loaded` gate" posture as `projects` immediately above.
 *
 * WP3 (the access flip): a `reportId` resume (`/reports/[id]/edit`,
 * `/daily/[id]/edit`) is now owner-gated, mirroring `reports_update` RLS
 * (supabase/migrations/20260726000018_scoped_access.sql) -- under scoped
 * reads a pm/admin can legitimately see (and, via the dashboard/daily list,
 * navigate directly to the URL for) a report they don't own, but they can
 * never SAVE an edit to it; letting them reach the wizard anyway would mean
 * filling out a whole form only to have the final write rejected. `found`
 * (this same file's existing resolved-report lookup) is reused for the
 * check -- no second fetch. See `blockedByAccess`/`accessPending` below.
 */
export function WizardPage({ reportId, kind = 'weekly' }: WizardPageProps) {
  const router = useRouter();
  const { reports: weeklyReports, upsertReport: upsertWeekly, loadError: weeklyLoadError } = useReports();
  const { reports: dailyReports, upsertReport: upsertDaily, loadError: dailyLoadError } = useDailyReports();
  const { projects } = useProjects();
  // WP2: the team directory, for StepTasks' Assignee picker -- same
  // graceful-degrade posture as `projects` immediately above (not part of
  // the `loaded` gate below; an empty/still-loading list just means no
  // options besides "Unassigned" for a moment, never a blocked render).
  const { members: teamMembers } = useTeamMembers();
  // WP3: the signed-in user -- feeds both the owner-only resume gate below
  // and `currentUserId` (threaded into `useWizard`'s daily-date-conflict
  // scoping, see that hook's own doc comment).
  const { user, loading: sessionLoading } = useSession();
  const supabaseConfigured = isSupabaseConfigured();

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

  /**
   * WP3 (the access flip): only meaningful when resuming an EXISTING report
   * (`reportId` set) -- `/reports/new`/`/daily/new` never resolve a `found`
   * report, so `canEditReport(null, ...)` there is always `false` by that
   * function's own null-guard, which is exactly why `blockedByAccess` below
   * is additionally gated on `found !== null` (a brand-new draft must never
   * be treated as "blocked").
   *
   * In demo mode `canEditReport` short-circuits to `true` unconditionally
   * (no session concept at all -- see that function's own doc comment), so
   * `accessPending`/`blockedByAccess` are both always `false` there,
   * matching this route's pre-WP3 behavior byte-for-byte. In Supabase mode,
   * `accessPending` covers the one real timing gap: `canEditReport` reads
   * `access.loading` and returns `false` while the session is still
   * resolving, which would otherwise misfire the redirect below for the
   * OWNER's own report during that brief window -- so the redirect (and the
   * render gate) waits for `sessionLoading` to settle before trusting a
   * `false` result.
   */
  const accessPending = Boolean(reportId) && found !== null && supabaseConfigured && sessionLoading;
  const canEditFound = canEditReport(found, { user, loading: sessionLoading, supabaseConfigured });
  const blockedByAccess = Boolean(reportId) && found !== null && !accessPending && !canEditFound;
  // Redirects to the read-only report screen (not the list) -- the report IS
  // visible to this caller (it came back from `sameKindReports`, which is
  // itself `reports_select`-scoped), just not editable by them; the view
  // route is a strictly more useful landing spot than bouncing to the list.
  const viewHref = reportId ? `${exitHref}/${reportId}` : exitHref;

  useEffect(() => {
    if (notFound) router.replace(exitHref);
  }, [notFound, router, exitHref]);

  useEffect(() => {
    if (blockedByAccess) router.replace(viewHref);
  }, [blockedByAccess, router, viewHref]);

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
  // wizard. WP3: also render nothing while the owner-only access check is
  // still pending (a resolving session, Supabase mode only -- see
  // `accessPending`'s doc comment) or once it has determined this caller
  // may not edit this report (the redirect effect above is about to fire) --
  // this is what actually stops a non-owner's "Continue"/direct-URL visit
  // from ever showing the fillable wizard, even for the single render this
  // component would otherwise produce before the effect runs.
  if (!loaded || notFound || accessPending || blockedByAccess) return null;

  const initialReport = found ? structuredClone(found) : null;

  return (
    <>
      <WizardScreen
        key={reportId ?? 'new'}
        kind={kind}
        reports={sameKindReports ?? []}
        dailies={kind === 'weekly' ? (dailyReports ?? []) : undefined}
        projects={projects ?? []}
        teamMembers={teamMembers ?? []}
        currentUserId={user?.id}
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
