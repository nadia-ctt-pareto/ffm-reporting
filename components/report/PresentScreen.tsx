'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';
import type { ReportKind } from '@/lib/types';
import { DECK_SLIDE_COUNT, DECK_SLIDE_HEIGHT, DECK_SLIDE_TITLES, DECK_SLIDE_WIDTH, ReportDeck } from './ReportDeck';
import '@/styles/print.css';
import styles from './PresentScreen.module.css';

export interface PresentScreenProps {
  id: string;
  /** Phase 4: which store to resolve `id` against and which route "Back to Report" points at. Defaults to 'weekly' -- the pre-Phase-4 call site (`/reports/[id]/present`) keeps working unchanged. */
  kind?: ReportKind;
}

/** Minimum horizontal swipe distance (px) that counts as a slide-change gesture (vs. a tap/click). */
const SWIPE_THRESHOLD = 48;

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'PageDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
const SPACE_KEYS = new Set([' ', 'Spacebar']);
// Derived from DECK_SLIDE_COUNT (not hardcoded) so the digit-jump shortcut
// never silently drifts out of sync with the deck's actual slide count.
// Assumes DECK_SLIDE_COUNT stays a single digit (1-9) -- true today (6) and
// for any deck size this app is realistically going to have.
const DIGIT_KEY = new RegExp(`^[1-${DECK_SLIDE_COUNT}]$`);

function clampSlide(n: number): number {
  return Math.min(Math.max(1, n), DECK_SLIDE_COUNT);
}

/**
 * `/reports/[id]/present` (weekly) and `/daily/[id]/present` (Phase 4) --
 * the bare, read-only, branded slide-deck route (no sidebar; only the root
 * layout applies -- see app/reports/[id]/present/page.tsx and
 * app/daily/[id]/present/page.tsx).
 *
 * Phase 5: this is now an INTERACTIVE deck -- one slide visible at a time,
 * with prev/next, a dot navigator, digit/arrow/Home/End keyboard shortcuts,
 * basic touch swipe, a `?slide=n` deep link, and a fullscreen toggle. All 6
 * slides stay permanently mounted (`<ReportDeck activeSlide={slide - 1}>`)
 * -- "one slide at a time" is implemented purely as a `@media
 * screen`-scoped CSS hiding rule in ReportDeck.module.css, so print output
 * is completely unaffected by which slide happens to be showing on screen;
 * see that file's doc comment. Conditionally rendering only the active
 * slide is explicitly avoided: `window.print()` snapshots the current DOM
 * synchronously, and `beforeprint` cannot reliably flush a React
 * re-render first -- that would resurrect the old 7-page-PDF class of bug.
 *
 * `?print=1` auto-triggers `window.print()` once the report has loaded,
 * fonts are ready, and one animation frame has passed -- byte-identical to
 * pre-Phase-5; which slide happens to be active is irrelevant to print
 * output (see above), so this flow needed no changes at all.
 *
 * Font-loading note: browsers may skip loading webfonts used only inside a
 * `display:none` subtree, but the only webfonts here are Poppins/Open Sans
 * (`next/font/google`, loaded globally via app/layout.tsx), both of which
 * are also used on the always-visible toolbar/nav chrome -- so
 * `document.fonts.ready` still covers every hidden slide's fonts too. The
 * serif hero stat (`--font-display-serif`) is a system-font fallback (see
 * ReportDeck.tsx), not a webfont, so it's unaffected either way.
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

  // A callback ref (state, not a plain useRef) -- this component returns
  // `null` on its very first render (see the `reports === null` early
  // return below; `useReports`/`useDailyReports` start `reports` at
  // `null`), so the stage `<div>` doesn't exist in the DOM on that pass. A
  // plain `useRef` + `useEffect(..., [])` reads `stageRef.current` while
  // it's still `null` on the ONE time that effect runs and never re-runs --
  // the ResizeObserver never attaches and `scale` stays permanently `1`
  // (verified: at a 1200x800 viewport the 1280px-wide slide clipped on the
  // right with no scrollbar, since `.stage` also has `overflow: hidden`;
  // at 1920x1080 the documented "scale > 1 on a big display" behavior never
  // happened either). A callback ref re-fires whenever the node itself
  // mounts/unmounts, so `stageEl` correctly becomes non-null the moment the
  // stage div actually exists, regardless of which render pass that is.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // 1-based in the URL/UI (matches DECK_SLIDE_TITLES' natural numbering and
  // the "3 / 6" counter); converted to 0-based when handed to <ReportDeck>.
  const [slide, setSlide] = useState(() => {
    const raw = Number(searchParams.get('slide'));
    return Number.isFinite(raw) ? clampSlide(Math.trunc(raw)) : 1;
  });

  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // document.fullscreenEnabled is only readable client-side; start false
  // (matching SSR) and flip after mount -- same hydration-safety pattern as
  // ThemeProvider's `hydrated` guard, just for a simpler one-shot value.
  useEffect(() => {
    setFullscreenSupported(typeof document !== 'undefined' && Boolean(document.fullscreenEnabled));
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageEl);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [stageEl]);

  // Two-axis fit: a single 1280x720 slide must fit inside the stage's
  // available box on BOTH axes (unlike the old filmstrip's width-only
  // shrink-to-fit against a tall scrolling stack of 6 slides). Allow scale
  // > 1 -- a large display/projector should fill the screen, not stay
  // pinned at native size. Also re-fires for free on fullscreen toggle: the
  // stage's clientWidth/clientHeight change is exactly what ResizeObserver
  // watches. Depends on `stageEl` (the callback ref's state), not a plain
  // ref -- see `stageEl`'s own doc comment for why that distinction is
  // load-bearing here.
  useEffect(() => {
    if (!stageEl || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = stageEl.clientWidth;
      const height = stageEl.clientHeight;
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(width / DECK_SLIDE_WIDTH, height / DECK_SLIDE_HEIGHT));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

  const report = reports?.find((r) => r.id === id) ?? null;
  const notFound = reports !== null && report === null;

  // Deep-link sync: `history.replaceState` (never `router.replace`, and
  // never mixed with it for this same param) so a slide change never
  // triggers a Next re-render/scroll-restoration pass -- Next 14.1+ keeps
  // `useSearchParams` synced with direct History mutations. Reads/rewrites
  // off `window.location.search` (not a bare `'?slide=' + n` string) so
  // every OTHER query param -- notably `?print=1` -- survives untouched;
  // this only runs from an explicit slide-change action (never on mount),
  // so the initial `?print=1` deep link is never at risk of being clobbered.
  //
  // `replaceState` is called here, in the plain function body -- NEVER
  // inside a `setSlide` updater callback. React invokes updater functions
  // during the render phase (and may invoke them more than once), so a
  // side effect there -- `history.replaceState` synchronously triggers
  // Next's own Router-context state sync, which is exactly what keeps
  // `useSearchParams` in sync with it -- trips React's "Cannot update a
  // component while rendering a different component" invariant (verified:
  // moving it into the updater reproduced that exact console error on
  // every slide change). `goToSlide` is only ever called from event
  // handlers (click/keydown/pointerup), never during render, so calling it
  // directly here is safe.
  const goToSlide = useCallback((next: number) => {
    const clamped = clampSlide(next);
    setSlide(clamped);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('slide', String(clamped));
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  const goNext = useCallback(() => goToSlide(slide + 1), [goToSlide, slide]);
  const goPrev = useCallback(() => goToSlide(slide - 1), [goToSlide, slide]);

  // Keyboard nav -- guarded against modifier keys, already-handled events,
  // and typing inside a form control. Escape is deliberately NOT bound to
  // navigation: it only exits fullscreen (the browser's own native
  // behavior) -- a share-link viewer has no "back" destination, so
  // hijacking Esc for navigation would be a trap.
  //
  // Space is a SEPARATE guard from the "typing inside a form control" one
  // above: this listener is on `window`, so pressing Space while a nav
  // button/link is focused fired `goNext()` on keydown here AND the
  // button's own native activation on keyup -- net effect, nothing moved,
  // and a keyboard-only user had no working way to activate ANY nav
  // control (prev/next/dots/fullscreen) with Space (verified: Tab to
  // "Previous slide", press Space -> no navigation happens at all). Bail
  // out of this handler entirely for Space when the target is itself an
  // interactive control, letting the browser's native activation win.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (SPACE_KEYS.has(e.key) && target?.closest('button, a, [role="button"]')) return;

      if (NEXT_KEYS.has(e.key)) {
        e.preventDefault();
        goNext();
      } else if (PREV_KEYS.has(e.key)) {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToSlide(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToSlide(DECK_SLIDE_COUNT);
      } else if (DIGIT_KEY.test(e.key)) {
        e.preventDefault();
        goToSlide(Number(e.key));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, goToSlide]);

  // Touch/pen only -- NOT mouse. `pointerdown`/`pointerup` also fire for
  // `pointerType: 'mouse'`, so without this gate, selecting text across a
  // slide (or any plain >48px horizontal mouse drag) navigated the deck.
  // `setPointerCapture` routes the matching `pointerup` (and
  // `pointercancel`) to THIS element even if the finger lifts outside the
  // stage's bounds, so a swipe that drifts off-element still resolves
  // (rather than leaving `pointerStartRef` stuck, which would otherwise
  // make the NEXT unrelated `pointerup` compute its delta against a stale
  // origin and fire a phantom swipe).
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  // Safety net alongside `setPointerCapture` above: an OS-level gesture
  // (e.g. an incoming call, a system swipe) can fire `pointercancel`
  // without a matching `pointerup` -- clear the stale origin so it can't
  // feed a phantom swipe into some later, unrelated pointer sequence.
  const handlePointerCancel = () => {
    pointerStartRef.current = null;
  };

  const toggleFullscreen = () => {
    if (!stageEl) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageEl.requestFullscreen().catch(() => {});
    }
  };

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

  return (
    <div className={`${styles.page} presentPage`}>
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

      <div
        ref={setStageEl}
        className={`${styles.stage} presentStage`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className="slideScaler"
          style={{
            width: DECK_SLIDE_WIDTH,
            height: DECK_SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <ReportDeck report={report} activeSlide={slide - 1} />
        </div>

        <div className={`${styles.nav} presentNav`}>
          <button type="button" className={styles.navArrow} onClick={goPrev} aria-label="Previous slide">
            &larr;
          </button>
          <div className={styles.navDots}>
            {DECK_SLIDE_TITLES.map((title, i) => {
              const n = i + 1;
              const active = n === slide;
              return (
                <button
                  key={title}
                  type="button"
                  className={`${styles.navDot} ${active ? styles.navDotActive : ''}`}
                  onClick={() => goToSlide(n)}
                  aria-label={`Slide ${n}: ${title}`}
                  aria-current={active ? 'true' : undefined}
                />
              );
            })}
          </div>
          <button type="button" className={styles.navArrow} onClick={goNext} aria-label="Next slide">
            &rarr;
          </button>
          <span className={styles.navCounter}>
            {slide} / {DECK_SLIDE_COUNT}
          </span>
          {fullscreenSupported ? (
            <button
              type="button"
              className={styles.navFullscreen}
              onClick={toggleFullscreen}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
