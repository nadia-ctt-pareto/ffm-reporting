'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ReportDeck } from '@/components/report/ReportDeck';
import { Button } from '@/components/ui/Button';
import { endOfWeekISO, startOfWeekISO } from '@/lib/calendar';
import { buildDeckSlides } from '@/lib/deck-slides';
import { nowDate } from '@/lib/format';
import { useAssignedTasks } from '@/lib/hooks/useAssignedTasks';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';
import { useSession } from '@/lib/hooks/useSession';
import { assignedTaskOverlapsRange, buildSyntheticReport, filterReportsByScope, reportsInRange } from '@/lib/my-week';
import type { MyWeekScope } from '@/lib/my-week';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { mergeTaskSources } from '@/lib/task-merge';
import type { AnyReport } from '@/lib/types';
import '@/styles/print.css';
import styles from './MyWeekPresentScreen.module.css';

function isMyWeekScope(value: string | null): value is MyWeekScope {
  return value === 'mine' || value === 'everyone';
}

/**
 * `/my-week/present` -- WP6's print route (see app/my-week/present/page.tsx
 * for why this lives outside `(shell)` and is session-gated, not
 * token-gated).
 *
 * REBUILDS the synthetic report from scratch on every mount, from the exact
 * same hooks + pure functions `/my-week` (`MyWeekScreen.tsx`) itself uses
 * (`useReports`/`useDailyReports`/`useAssignedTasks`/`useSession`,
 * `lib/my-week.ts`) -- never from localStorage or a global. The only things
 * that travel through the URL are `weekStart`/`scope`/(optional)`date`,
 * mirroring `MyWeekScreen`'s own Export button -- this is what makes the
 * route linkable and reload-safe: reloading this exact URL always
 * reconstructs the identical digest from whatever the viewer's OWN session
 * can see right now (a pm+'s "Everyone" export genuinely re-reads every
 * report their session's `useReports()`/`useDailyReports()` calls resolve to
 * -- org-wide, per `reports_select` -- not a frozen snapshot from the moment
 * the Export button was clicked).
 *
 * Composes `ReportDeck` (UNMODIFIED, un-paged -- every slide stacked, the
 * same rendering mode this component has always had when no `activeSlide`
 * is passed -- see that component's own doc comment) with the shared
 * `styles/print.css` (UNMODIFIED) and the exact `?print=1` auto-print idiom
 * `PresentScreen.tsx` established. That effect is DUPLICATED here (not
 * imported from that file) specifically because `PresentScreen` resolves its
 * report by `id` against the real repository/share-token path and is
 * explicitly off-limits to modify for this package (CLAUDE.md's binding
 * constraints) -- mirroring its ~15-line effect verbatim is far lower risk
 * than reshaping that component to also accept an already-built synthetic
 * report it was never designed to hold.
 *
 * `.previewWrap` below is a SCREEN-ONLY convenience wrapper (centers the
 * deck, scrolls horizontally on a narrow viewport). Unlike `PresentScreen`,
 * this route does not paginate one slide at a time, so it needs none of that
 * component's fixed-height `.page`/`.stage`/two-axis-scaling machinery --
 * and therefore introduces none of the screen-only-ancestor print risk that
 * machinery is so heavily documented against (styles/print.css's header
 * comment). The one screen-only property this wrapper DOES set
 * (`overflow-x: auto`, so a 1280px-wide deck doesn't clip on a narrower
 * screen) is neutralized by THIS component's OWN `@media print` rule
 * (MyWeekPresentScreen.module.css), not a change to the shared print.css --
 * safe here specifically because the screen rule and its print counter-rule
 * live in the same file/chunk (deterministic load order, no cross-stylesheet
 * `!important` fight), unlike the shared print.css's own reason for existing
 * as a separate global file.
 */
export function MyWeekPresentScreen() {
  const searchParams = useSearchParams();
  const weekStartParam = searchParams.get('weekStart') ?? startOfWeekISO(nowDate());
  const dateParam = searchParams.get('date');
  const scopeParam = searchParams.get('scope');
  const scope: MyWeekScope = isMyWeekScope(scopeParam) ? scopeParam : 'mine';
  const autoPrint = searchParams.get('print') === '1';
  const printedRef = useRef(false);

  const weeklyHook = useReports();
  const dailyHook = useDailyReports();
  const { tasks: assignedTasks } = useAssignedTasks();
  const { user, loading: sessionLoading } = useSession();
  // Fresh object every render on purpose -- see MyWeekScreen.tsx's identical
  // `access` construction and doc comment for why that's safe alongside the
  // `useMemo` deps below (primitives only, not `access` itself).
  const access = { user, loading: sessionLoading, supabaseConfigured: isSupabaseConfigured() };

  const reports = weeklyHook.reports;
  const dailies = dailyHook.reports;
  const loadError = weeklyHook.loadError ?? dailyHook.loadError;

  const weekEnd = endOfWeekISO(weekStartParam);
  const rangeStart = dateParam ?? weekStartParam;
  const rangeEnd = dateParam ?? weekEnd;

  const report = useMemo(() => {
    if (reports === null || dailies === null) return null;
    const allReports: AnyReport[] = [...reports, ...dailies];
    const scopedReports = filterReportsByScope(allReports, scope, access);
    const reportsForRange = reportsInRange(scopedReports, rangeStart, rangeEnd);
    const assignedForRange = (assignedTasks ?? []).filter((t) => assignedTaskOverlapsRange(t, rangeStart, rangeEnd));
    const mergedTasks = mergeTaskSources(reportsForRange, assignedForRange, access);
    const bridgeOnlyTasks = mergedTasks.filter((e) => !e.source.canOpen).map((e) => e.task);

    // Cosmetic cover-slide labels only -- not specified by any access rule.
    // "Everyone" names the whole team as the audience; "Mine" names the
    // viewer themself, falling back to a generic label in demo mode (no
    // session, `user` is always null there).
    const preparedFor = scope === 'everyone' ? 'Foundation First Marketing — Whole Team' : (user?.email ?? 'My Digest');
    const preparedBy = user?.email ?? 'Weekly Reports';

    return dateParam
      ? buildSyntheticReport({
          kind: 'daily',
          date: dateParam,
          sources: reportsForRange,
          bridgeOnlyTasks,
          preparedFor,
          preparedBy,
          now: nowDate(),
        })
      : buildSyntheticReport({
          kind: 'weekly',
          weekStart: weekStartParam,
          weekEnd,
          sources: reportsForRange,
          bridgeOnlyTasks,
          preparedFor,
          preparedBy,
          now: nowDate(),
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, dailies, assignedTasks, user, sessionLoading, scope, rangeStart, rangeEnd, dateParam, weekStartParam, weekEnd]);

  const slides = useMemo(() => (report ? buildDeckSlides(report) : null), [report]);

  // Byte-for-byte the same effect as PresentScreen.tsx's own `?print=1`
  // auto-print -- see this component's own doc comment for why it's
  // duplicated rather than shared.
  useEffect(() => {
    if (!autoPrint || !report || printedRef.current) return;
    let cancelled = false;
    const triggerPrint = () => {
      if (cancelled || printedRef.current) return;
      printedRef.current = true;
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    };
    document.fonts.ready.then(triggerPrint);
    return () => {
      cancelled = true;
    };
  }, [autoPrint, report]);

  // Still-loading gate, mirroring PresentScreen.tsx's session-based path.
  if (reports === null || dailies === null) {
    if (loadError) {
      return <div className={`${styles.page} ${styles.loadError}`}>Failed to load your reports: {loadError}</div>;
    }
    return null;
  }
  if (!report || !slides) return null;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link href="/my-week" className={styles.backLink}>
          &larr; Back to My Week
        </Link>
        <Button variant="dark" size="sm" onClick={() => window.print()}>
          Download PDF
        </Button>
      </div>
      <div className={styles.previewWrap}>
        <ReportDeck report={report} slides={slides} />
      </div>
    </div>
  );
}
