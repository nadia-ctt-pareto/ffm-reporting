'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { buildDeckSlides } from '@/lib/deck-slides';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { AnyReport, ReportKind } from '@/lib/types';
import { DECK_SLIDE_HEIGHT, DECK_SLIDE_WIDTH, ReportDeck } from './ReportDeck';
import '@/styles/print.css';
import styles from './PresentScreen.module.css';

export interface PresentScreenProps {
  id: string;
  /** Phase 4: which store to resolve `id` against and which route "Back to Report" points at. Defaults to 'weekly' -- the pre-Phase-4 call site (`/reports/[id]/present`) keeps working unchanged. */
  kind?: ReportKind;
  /**
   * Phase 7b (M3): the tokened-share resolution, computed server-side by
   * `app/reports/[id]/present/page.tsx` / `app/daily/[id]/present/page.tsx`
   * (see those files' `resolveShared`). Three distinct states, on purpose --
   * this is CLAUDE.md's "carried trap #2": once a token is present, the
   * session/hooks path must never be consulted, even for a signed-in
   * visitor whose OWN session could otherwise read the report.
   *
   *   - `undefined` (the default): no token was present -- fall back to the
   *     existing `useReports()`/`useDailyReports()` session-based path,
   *     byte-for-byte unchanged from pre-M3.
   *   - `null`: a token WAS present but didn't resolve (wrong id, wrong
   *     kind, revoked, or genuinely invalid) -- render the not-found state
   *     immediately. The hooks below are called with `enabled: false` in
   *     this case too, so no guaranteed-401 (or, worse, session-satisfied)
   *     fetch ever fires.
   *   - an `AnyReport`: the token resolved to a real, matching, still-shared
   *     report -- render it directly. Already resolved server-side, so this
   *     renders on the very first pass (SSR included), with no loading gate.
   */
  shared?: AnyReport | null;
}

/** Minimum horizontal swipe distance (px) that counts as a slide-change gesture (vs. a tap/click). */
const SWIPE_THRESHOLD = 48;

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'PageDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
const SPACE_KEYS = new Set([' ', 'Spacebar']);
/**
 * WP1 (dynamic slide model): the deck's slide count is no longer a
 * compile-time constant (see `buildDeckSlides`, lib/deck-slides.ts), so this
 * can no longer be built from it. Fixed at `1-9` instead -- decks with 10 or
 * more slides simply get digit shortcuts only for slides 1-9 (every digit
 * key still needs a real, explicit `n <= slideCount` guard below before
 * calling `goToSlide`, since this regex alone can't know today's slide
 * count). Deliberately no multi-digit input buffer (e.g. typing "1" then "2"
 * within a short window to reach slide 12) -- dots/arrows/Home/End already
 * cover reaching any slide, and a buffer adds real complexity (a timeout,
 * a partial-input indicator) for a case this app doesn't have yet.
 */
const DIGIT_KEY = /^[1-9]$/;

function clampSlide(n: number, count: number): number {
  return Math.min(Math.max(1, n), count);
}

/**
 * Phase 7b (M3): the pre-M3 not-found copy explained a localStorage-only
 * limitation that stops being true once Supabase is configured (a report
 * genuinely doesn't exist / isn't shared anymore -- not "wrong browser").
 * Demo mode (`isSupabaseConfigured() === false`) keeps the exact original
 * copy, byte-for-byte -- required by CLAUDE.md's "demo mode must keep
 * working" constraint. Deliberately generic about WHY a tokened link failed
 * (wrong id, wrong kind, revoked, malformed) -- distinguishing those to the
 * visitor would turn this into an oracle for probing valid ids/tokens.
 */
function notFoundCopy(usingToken: boolean): string {
  if (!isSupabaseConfigured()) {
    return "This link doesn't resolve to a report in this browser. Shared links only resolve on a browser whose local storage has the report -- true cross-machine sharing arrives with Supabase.";
  }
  return usingToken
    ? "This share link is no longer valid -- it may have been revoked, or it never matched this report. Ask the report's owner for a fresh link."
    : "This report doesn't exist, or something went wrong loading it.";
}

/**
 * `/reports/[id]/present` (weekly) and `/daily/[id]/present` (Phase 4) --
 * the bare, read-only, branded slide-deck route (no sidebar; only the root
 * layout applies -- see app/reports/[id]/present/page.tsx and
 * app/daily/[id]/present/page.tsx).
 *
 * Phase 5: this is now an INTERACTIVE deck -- one slide visible at a time,
 * with prev/next, a dot navigator, digit/arrow/Home/End keyboard shortcuts,
 * basic touch swipe, a `?slide=n` deep link, and a fullscreen toggle. ALL of
 * the deck's slides stay permanently mounted
 * (`<ReportDeck slides={slides} activeSlide={current - 1}>`) -- "one slide
 * at a time" is implemented purely as a `@media screen`-scoped CSS hiding
 * rule in ReportDeck.module.css, so print output is completely unaffected
 * by which slide happens to be showing on screen; see that file's doc
 * comment. Conditionally rendering only the active slide is explicitly
 * avoided: `window.print()` snapshots the current DOM synchronously, and
 * `beforeprint` cannot reliably flush a React re-render first -- that would
 * resurrect the old 7-page-PDF class of bug.
 *
 * WP1 (dynamic slide model): the slide LIST itself is now data
 * (`buildDeckSlides`, lib/deck-slides.ts), memoized here off `report`, not a
 * hardcoded "6" -- `slideCount`/`current`/the digit-key guard/the dot
 * navigator/the "n / N" counter all read off `slides`/`slides.length`
 * rather than a module constant. WP1 itself never varies the count (always
 * exactly six, for every report), so this is purely a representation
 * change: the rendered deck and printed PDF are unaffected.
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
export function PresentScreen({ id, kind = 'weekly', shared }: PresentScreenProps) {
  // Phase 7b (M3): `shared !== undefined` means a token was present (valid
  // or not) -- the session/hooks path must be short-circuited entirely in
  // that case, not merely ignored, so both hooks are called with
  // `enabled: false`. This is what makes "the token is the only key"
  // structural rather than behavioral: a signed-in visitor's own session
  // fetch simply never fires, so there is nothing for a wrong/missing token
  // to accidentally fall back to. See CLAUDE.md's "carried trap #2".
  const usingToken = shared !== undefined;
  const weeklyHook = useReports({ enabled: !usingToken });
  const dailyHook = useDailyReports({ enabled: !usingToken });
  const reports = kind === 'daily' ? dailyHook.reports : weeklyHook.reports;
  const hookLoadError = kind === 'daily' ? dailyHook.loadError : weeklyHook.loadError;
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const printedRef = useRef(false);

  // A callback ref (state, not a plain useRef) -- this component returns
  // `null` on its very first render in the session-based (no-token) path
  // (see the "still-loading gate" below; `useReports`/`useDailyReports`
  // start `reports` at `null`), so the stage `<div>` doesn't exist in the
  // DOM on that pass. A
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

  // 1-based in the URL/UI (matches the present-page navigator's dot
  // numbering and the "3 / N" counter); converted to 0-based when handed to
  // <ReportDeck>.
  //
  // WP1 (dynamic slide model): this initial value can no longer be clamped
  // against the deck's real slide count -- `slides` (below) doesn't exist
  // yet on this very first render, since it's derived from `report`, which
  // itself hasn't loaded on the session-based path's first pass (see the
  // "still-loading gate" further down). So `slide` deliberately keeps the
  // user's RAW intent (only floored at 1 -- never 0 or negative) rather than
  // clamping it here; `current` (below `slides`) is the actual clamped,
  // rendered position, derived fresh on every render once the real slide
  // count is known. This is what lets a stale `?slide=99` deep link (or one
  // for a report that has since shrunk) degrade to showing the last slide
  // instead of blanking, without this state ever needing to know the count
  // up front.
  const [slide, setSlide] = useState(() => {
    const raw = Number(searchParams.get('slide'));
    return Number.isFinite(raw) ? Math.max(1, Math.trunc(raw)) : 1;
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

  // Phase 7b (M3): the token path's `report` is already fully resolved
  // (server-side, before this component even mounted -- see `shared`'s doc
  // comment above) -- it never depends on `reports`/`hookLoadError` at all.
  const report = usingToken ? (shared ?? null) : (reports?.find((r) => r.id === id) ?? null);
  // A failed session-based load (`hookLoadError` set, e.g. Supabase
  // unreachable, a non-401 server error) used to leave this route blank
  // forever (`reports` stays `null`, so the "still loading" gate below never
  // clears) -- now surfaces the same not-found state a missing id would,
  // rather than a permanent blank page.
  const notFound = usingToken ? report === null : report === null || Boolean(hookLoadError);

  // WP1 (dynamic slide model): `slides` is `null` until `report` resolves --
  // `buildDeckSlides` (lib/deck-slides.ts) is a pure function of `report`
  // alone (see that module's doc comment on why that purity is load-bearing:
  // a future server-rendered token path must never disagree with this
  // client `useMemo`). `slideCount`/`current` fall back to `1` while
  // `slides` is still `null` so every hook/handler below this point can be
  // declared unconditionally (React's rules of hooks) without a `slides!`
  // non-null assertion; the real render (further down) bails out before
  // ever reading a bogus `slideCount`/`current` if `report` never resolves.
  const slides = useMemo(() => (report ? buildDeckSlides(report) : null), [report]);
  const slideCount = slides ? slides.length : 1;
  // The clamped, ACTUALLY-rendered 1-based slide position -- see `slide`'s
  // own doc comment above for why this is derived fresh every render instead
  // of being what `slide` itself holds.
  const current = clampSlide(slide, slideCount);

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
  const goToSlide = useCallback(
    (next: number) => {
      const clamped = clampSlide(next, slideCount);
      setSlide(clamped);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.set('slide', String(clamped));
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      }
    },
    [slideCount],
  );

  // Arithmetic is against `current` (the CLAMPED, rendered position), not
  // the raw `slide` state -- deliberate, and only matters for a stale/
  // out-of-range deep link (see `slide`'s doc comment). Example: `?slide=99`
  // on a 6-slide deck leaves raw `slide` at 99 while `current` renders 6;
  // pressing Previous must land on slide 5, the slide before what's ON
  // SCREEN. Computing `goPrev` from the raw value would do `clampSlide(99 -
  // 1, 6)` = `clampSlide(98, 6)` = 6 -- clamped straight back to the same
  // slide, silently stranding Previous with no effect. Basing it on
  // `current` instead (`clampSlide(6 - 1, 6)` = 5) makes Previous/Next
  // always move exactly one slide from whatever is actually visible.
  const goNext = useCallback(() => goToSlide(current + 1), [goToSlide, current]);
  const goPrev = useCallback(() => goToSlide(current - 1), [goToSlide, current]);

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
        goToSlide(slideCount);
      } else if (DIGIT_KEY.test(e.key)) {
        // WP1: DIGIT_KEY alone only knows "single digit 1-9" -- it has no
        // idea how many slides this particular deck actually has. The
        // explicit `n <= slideCount` guard is what keeps, say, pressing "9"
        // on today's 6-slide deck a no-op instead of jumping past the end
        // (`goToSlide` would silently clamp it back to the last slide
        // anyway, but skipping the call entirely also skips the
        // `history.replaceState` write and the digit-key `preventDefault`,
        // matching every other "not a valid shortcut right now" key above).
        const n = Number(e.key);
        if (n <= slideCount) {
          e.preventDefault();
          goToSlide(n);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, goToSlide, slideCount]);

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

  // Still-loading gate: only the session-based path (no token) ever needs to
  // wait for a fetch. The token path's `report`/`notFound` are already fully
  // resolved above (see `shared`'s doc comment) -- there is nothing to wait
  // for, so a tokened visit never blocks here, even while the deliberately
  // disabled (`enabled: false`) hooks sit at their initial `reports === null`
  // state forever. `!hookLoadError` in the guard is what lets a genuinely
  // failed session-based load fall through to the `notFound` render below
  // instead of staying blank forever (see `notFound`'s own comment above).
  if (!usingToken && reports === null && !hookLoadError) return null;

  if (notFound) {
    return (
      <div className={styles.notFoundWrap}>
        <div className={styles.notFoundMark}>Foundation First Marketing</div>
        <h1 className={styles.notFoundTitle}>Report Not Found</h1>
        <p className={styles.notFoundCopy}>{notFoundCopy(usingToken)}</p>
        {/* Post-review fix: an anonymous tokened visitor has no account in
            this app -- `/reports`/`/daily` are NOT in middleware.ts's public
            path list (only the present routes themselves are), so this link
            was a login dead-end for exactly the person this route exists to
            serve. There is nowhere sensible to send them, so the session
            path keeps the link and the token path shows nothing. */}
        {!usingToken ? (
          <Link href={kind === 'daily' ? '/daily' : '/reports'} className={styles.notFoundLink}>
            Back to {kind === 'daily' ? 'Daily Reports' : 'Weekly Reports'}
          </Link>
        ) : null}
      </div>
    );
  }

  if (!report) return null;
  // Type-narrowing safety net, not a reachable branch: `slides` is derived
  // from `report` via `useMemo(() => (report ? buildDeckSlides(report) :
  // null), [report])`, computed synchronously during THIS render -- by the
  // time control reaches this line, `report` is non-null (checked just
  // above), so `slides` is already the just-recomputed `DeckSlide[]` for it.
  // TypeScript can't see that correlation across two separately-derived
  // variables, so this satisfies the type checker for `slides.length`/
  // `slides.map` below without an `as DeckSlide[]` cast.
  if (!slides) return null;

  return (
    <div className={`${styles.page} presentPage`}>
      <div className={`${styles.toolbar} presentToolbar`}>
        {/* Post-review fix (the real SHOULD-FIX from the M3 review):
            `/reports/[id]`/`/daily/[id]` are NOT in middleware.ts's public
            path list (only `/reports/[id]/present`/`/daily/[id]/present`
            are) -- an anonymous tokened visitor clicking this used to hit
            `/login?next=/reports/[id]` for an app they have no account in,
            exactly the person M3 exists to serve. Gated on `!usingToken` so
            it only ever renders in the session-based path, where the
            visitor is already signed in and the destination is real. An
            empty `<span>` keeps this a two-child flex row (`.toolbar` is
            `justify-content: space-between`) so `.toolbarRight` stays
            pinned to the right edge instead of collapsing to the left when
            this slot renders nothing. */}
        {usingToken ? (
          <span aria-hidden="true" />
        ) : (
          <Link href={`${kind === 'daily' ? '/daily' : '/reports'}/${report.id}`} className={styles.backLink}>
            &larr; Back to Report
          </Link>
        )}
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
          <ReportDeck report={report} slides={slides} activeSlide={current - 1} />
        </div>

        <div className={`${styles.nav} presentNav`}>
          <button type="button" className={styles.navArrow} onClick={goPrev} aria-label="Previous slide">
            &larr;
          </button>
          <div className={styles.navDots}>
            {slides.map((s, i) => {
              const n = i + 1;
              const active = n === current;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`${styles.navDot} ${active ? styles.navDotActive : ''}`}
                  onClick={() => goToSlide(n)}
                  aria-label={`Slide ${n}: ${s.title}${s.part ? ` (${s.part.index} of ${s.part.total})` : ''}`}
                  aria-current={active ? 'true' : undefined}
                />
              );
            })}
          </div>
          <button type="button" className={styles.navArrow} onClick={goNext} aria-label="Next slide">
            &rarr;
          </button>
          <span className={styles.navCounter}>
            {current} / {slides.length}
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
