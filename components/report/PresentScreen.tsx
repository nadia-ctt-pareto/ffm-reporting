'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';
import type { ReportKind } from '@/lib/types';
import { DECK_SLIDE_WIDTH, DECK_TOTAL_HEIGHT, ReportDeck } from './ReportDeck';
import '@/styles/print.css';
import styles from './PresentScreen.module.css';

export interface PresentScreenProps {
  id: string;
  /** Phase 4: which store to resolve `id` against and which route "Back to Report" points at. Defaults to 'weekly' -- the pre-Phase-4 call site (`/reports/[id]/present`) keeps working unchanged. */
  kind?: ReportKind;
}

/** Screen-only vertical breathing room around the (possibly scaled) deck; zeroed by styles/print.css. */
const STAGE_PADDING = 40;

/**
 * `/reports/[id]/present` (weekly) and `/daily/[id]/present` (Phase 4) --
 * the bare, read-only, branded slide-deck route (no sidebar; only the root
 * layout applies -- see app/reports/[id]/present/page.tsx and
 * app/daily/[id]/present/page.tsx). Renders `<ReportDeck>` at full size
 * behind a screen-only toolbar (hidden in print via styles/print.css);
 * `?print=1` auto-triggers `window.print()` once the report has loaded,
 * fonts are ready, and one animation frame has passed (fonts must be
 * painted before Chromium rasterizes the print output).
 *
 * Reads `useSearchParams()` -- the caller wraps this component in
 * `<Suspense>`, which Next.js requires for that hook, or `next build`
 * fails prerendering this route.
 */
export function PresentScreen({ id, kind = 'weekly' }: PresentScreenProps) {
  const weeklyHook = useReports();
  const dailyHook = useDailyReports();
  const reports = kind === 'daily' ? dailyHook.reports : weeklyHook.reports;
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const printedRef = useRef(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Responsive on-screen fit: shrink (never enlarge) the 1280px-wide deck to
  // the stage's available width. Print ignores this entirely (see
  // styles/print.css's `.slideScaler` reset) -- the printed page IS the
  // slide, full size, no scaling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = el.clientWidth;
      setScale(width > 0 ? Math.min(1, width / DECK_SLIDE_WIDTH) : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

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

  // Reports haven't loaded yet: render nothing (matches every other route's
  // useReports-loading convention -- no hydration mismatch).
  if (reports === null) return null;

  if (notFound) {
    return (
      <div className={styles.notFoundWrap}>
        <div className={styles.notFoundMark}>Foundation First Marketing</div>
        <h1 className={styles.notFoundTitle}>Report Not Found</h1>
        <p className={styles.notFoundCopy}>
          {
            "This link doesn't resolve to a report in this browser. Shared links only resolve on a browser whose local storage has the report -- true cross-machine sharing arrives with Supabase."
          }
        </p>
        <Link href={kind === 'daily' ? '/daily' : '/'} className={styles.notFoundLink}>
          Back to {kind === 'daily' ? 'Daily Reports' : 'Dashboard'}
        </Link>
      </div>
    );
  }

  if (!report) return null;

  const stageHeight = Math.round(DECK_TOTAL_HEIGHT * scale) + STAGE_PADDING * 2;

  return (
    <div className={styles.page}>
      <div className={`${styles.toolbar} presentToolbar`}>
        <Link href={`${kind === 'daily' ? '/daily' : '/reports'}/${report.id}`} className={styles.backLink}>
          &larr; Back to Report
        </Link>
        <div className={styles.toolbarRight}>
          <span className={styles.toolbarHint}>Export via Chrome or Edge for a pixel-perfect PDF.</span>
          <Button variant="dark" size="sm" onClick={() => window.print()}>
            Download PDF
          </Button>
        </div>
      </div>
      <div ref={stageRef} className={`${styles.stage} presentStage`} style={{ height: stageHeight }}>
        <div
          className="slideScaler"
          style={{
            width: DECK_SLIDE_WIDTH,
            height: DECK_TOTAL_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            margin: '0 auto',
          }}
        >
          <ReportDeck report={report} />
        </div>
      </div>
    </div>
  );
}
