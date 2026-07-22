'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import type { DeckSlide, DeckSlideBody } from '@/lib/deck-slides';
import { fmtDateShort } from '@/lib/format';
import { onSchedule, openBlockers, reportPeriodLabel, riskTone, taskTone } from '@/lib/report-utils';
import type { AnyReport } from '@/lib/types';
import styles from './ReportDeck.module.css';

export interface ReportDeckProps {
  report: AnyReport;
  /**
   * WP1 (dynamic slide model): the ordered slide list, built by
   * `buildDeckSlides` (lib/deck-slides.ts) -- see that module's doc comment
   * for the "must stay a pure function of `report`" determinism
   * requirement. `ReportDeck` no longer decides how many slides exist or
   * what each one contains; it purely renders whatever `slides` hands it,
   * in order. Callers that want the un-paged, all-slides-stacked rendering
   * (e.g. a future PDF-preview strip, or any harness rendering the deck
   * outside the present route) still pass every slide -- `buildDeckSlides`
   * itself has no notion of "active slide".
   */
  slides: DeckSlide[];
  /**
   * Phase 5 (interactive present deck): 0-based index of the slide to show
   * on screen. When provided, the deck root gains the `deckPaged` modifier
   * class and every `<section>` gets `data-active={i === activeSlide}` --
   * see ReportDeck.module.css's `@media screen`-scoped hiding rule. When
   * omitted (e.g. ReportScreen's old PDF-preview filmstrip, now deleted),
   * rendering is byte-identical to pre-Phase-5: every slide visible,
   * stacked, at full size.
   */
  activeSlide?: number;
}

// Fixed slide geometry -- the single source of truth for both the CSS (fed
// in via custom properties on `.deck`, see the inline style below) and any
// JS math that needs to know deck dimensions (PresentScreen's responsive
// two-axis fit-scaling). Never hardcode 1280/720 anywhere else.
export const DECK_SLIDE_WIDTH = 1280;
export const DECK_SLIDE_HEIGHT = 720;
/** Screen-only vertical gap between stacked slides; print.css zeroes this to avoid a stray blank page. Still consumed by `deckVars` below (the un-paged, all-slides-stacked rendering path). */
export const DECK_SLIDE_GAP = 32;

const TASK_COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'deadline', label: 'Deadline' },
];

const deckVars: CSSProperties = {
  ['--slide-w' as string]: `${DECK_SLIDE_WIDTH}px`,
  ['--slide-h' as string]: `${DECK_SLIDE_HEIGHT}px`,
  ['--slide-gap' as string]: `${DECK_SLIDE_GAP}px`,
};

/**
 * The section's non-`.slide` modifier class for a given slide body type --
 * `.cover`/`.win` carry their own background/layout (the black cover band,
 * the sage win band); every other body type uses the shared `.padded`
 * treatment (flex column + 88/96px padding), same as before WP1's refactor.
 */
function slideSectionClass(type: DeckSlideBody['type']): string {
  switch (type) {
    case 'cover':
      return styles.cover;
    case 'win':
      return styles.win;
    default:
      return styles.padded;
  }
}

/**
 * Renders one slide's body (the JSX that used to live inline inside each of
 * the six hardcoded `<section>` blocks pre-WP1, moved verbatim). `report` is
 * still threaded through alongside `body` -- the `cover`/`summary`/`win`
 * branches read report fields directly (title/prepared-for/-by, touchpoints,
 * the win stat/label/narrative), exactly like before. The `tasks` branch
 * also reads full-report on-schedule/blocker counts via `onSchedule`/
 * `openBlockers` for its footnote -- deliberately from `report.tasks`, NOT
 * from `body.rows` -- because a future chunked Task Status deck must keep
 * showing the same whole-report counts on every chunk (only the LAST chunk
 * shows the footnote at all, per `body.showFootnote`), not a per-chunk
 * subset that would silently under-count.
 */
function renderSlideBody(body: DeckSlideBody, report: AnyReport): ReactNode {
  switch (body.type) {
    case 'cover': {
      const periodLabel = reportPeriodLabel(report);
      return (
        <>
          <div className={styles.coverDiagonal} aria-hidden="true" />
          <div className={styles.coverTop}>
            <div className={styles.coverKicker}>{report.kind === 'daily' ? 'Daily Report' : 'Weekly Report'}</div>
            <h1 className={styles.coverWeek}>{periodLabel}</h1>
            <div className={styles.coverMeta}>
              <div className={styles.coverMetaItem}>
                <div className={styles.coverMetaLabel}>Prepared for</div>
                <div className={styles.coverMetaValue}>{report.preparedFor || '—'}</div>
              </div>
              <div className={styles.coverMetaItem}>
                <div className={styles.coverMetaLabel}>Prepared by</div>
                <div className={styles.coverMetaValue}>{report.preparedBy || '—'}</div>
              </div>
            </div>
          </div>
          {report.win.stat ? (
            <div className={styles.coverHero}>
              {/* Regonia isn't self-hosted (see typography.css) -- this
                  falls back to Didot/Bodoni/serif, which is acceptable for
                  MVP. A licensed Regonia woff2 via next/font/local is a
                  one-file add later. */}
              <div className={styles.coverHeroStat}>{report.win.stat}</div>
              <div className={styles.coverHeroLabel}>{report.win.label}</div>
            </div>
          ) : null}
        </>
      );
    }

    case 'summary':
      return (
        <>
          <div className={styles.kicker}>{report.kind === 'daily' ? 'Today' : 'This Week'}</div>
          <p className={styles.narrative}>{report.summaryNarrative}</p>
          <div className={styles.statsGrid}>
            <StatCard label="Client Calls" value={String(report.touchpoints.calls || 0)} />
            <StatCard label="Emails" value={String(report.touchpoints.emails || 0)} />
            <StatCard label="Escalations" value={String(report.touchpoints.escalations || 0)} />
          </div>
          {report.touchpoints.narrative ? <p className={styles.caption}>{report.touchpoints.narrative}</p> : null}
        </>
      );

    case 'tasks': {
      const { onSched, total } = onSchedule(report);
      const blockers = openBlockers(report);
      const taskRows = body.rows.map((t) => ({
        client: t.client,
        task: t.task,
        status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
        deadline: fmtDateShort(t.deadline),
      }));
      return (
        <>
          <div className={styles.kicker}>Task Status</div>
          <div className={styles.tableWrap}>
            <Table columns={TASK_COLUMNS} rows={taskRows} dense />
          </div>
          {body.showFootnote ? (
            <div className={styles.slideFootnote}>
              {onSched} / {total} tasks on schedule &middot; {blockers} open blocker{blockers === 1 ? '' : 's'}
            </div>
          ) : null}
        </>
      );
    }

    case 'risks':
      return (
        <>
          <div className={styles.kicker}>{'Risks & Blockers'}</div>
          {body.rows.length > 0 ? (
            <div className={styles.riskGrid}>
              {body.rows.map((rk) => (
                <div key={rk.id} className={styles.riskCard}>
                  <div className={styles.riskHeading}>
                    <span>{rk.client}</span>
                    <Badge tone={riskTone(rk.severity)}>{rk.severity}</Badge>
                  </div>
                  <div className={styles.riskDescription}>{rk.description}</div>
                  <div className={styles.riskNextStep}>Next step: {rk.nextStep}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.mutedNote}>No open risks this week.</div>
          )}
        </>
      );

    case 'priorities':
      return (
        <>
          <div className={styles.kicker}>{report.kind === 'daily' ? 'Priorities' : "Next Week's Priorities"}</div>
          <ol className={styles.priorityList}>
            {body.rows.map((p, i) => (
              <li key={p.id} className={styles.priorityItem}>
                {/* WP1: an explicit running number (`startIndex + i`) instead
                    of the old CSS `counter(priority)` -- see
                    ReportDeck.module.css's `.priorityNum` for why the CSS
                    counter approach had to go (it silently restarts at 1 on
                    every slide, which would misnumber a future chunked
                    priorities continuation slide). `startIndex` is always 1
                    in WP1 (no chunking yet), so this renders identically to
                    the old counter() output today. */}
                <span className={styles.priorityNum}>{body.startIndex + i}.</span>
                {p.text}
              </li>
            ))}
          </ol>
        </>
      );

    case 'win':
      return (
        <>
          <div className={styles.kicker}>The Win</div>
          <div className={styles.winStat}>{report.win.stat || '—'}</div>
          <div className={styles.winLabel}>{report.win.label}</div>
          <p className={styles.winNarrative}>{report.win.narrative}</p>
        </>
      );

    default: {
      // Exhaustiveness guard: if a future work package adds a new
      // `DeckSlideBody` variant (e.g. `glance`/`tasksByClient`) without a
      // matching render branch here, this line fails to compile (`body` can
      // no longer be assigned to `never`) instead of silently rendering
      // nothing for that slide type.
      const exhaustive: never = body;
      return exhaustive;
    }
  }
}

/**
 * The branded report deck. Rendered verbatim by BOTH the bare
 * `/reports/[id]/present` route (full size, for on-screen viewing and
 * browser print-to-PDF) and any future scaled-down preview -- one component,
 * guaranteed screen/print/preview parity.
 *
 * Always renders brand-light regardless of the app's `data-theme`: the
 * `.deck` class (see ReportDeck.module.css) re-declares every semantic
 * token this file (and the reused Badge/StatCard/Table primitives) reads,
 * back to their light-mode values. Custom properties are inherited down
 * the DOM tree, so this locally overrides whatever `[data-theme='dark']`
 * set on a `<html>` ancestor -- the printed/shared artifact must look the
 * same no matter which theme the author happened to be in.
 *
 * `.slide`/`.deck` also carry plain (unhashed) global classnames alongside
 * their CSS-Module classes -- see styles/print.css, which is a global
 * stylesheet and can't select CSS-Modules' hashed classnames.
 *
 * Phase 4: generalized to `AnyReport` -- `reportPeriodLabel` resolves the
 * cover's period line ("Week of ..." vs. a single date) and the cover
 * kicker text switches "Weekly Report" / "Daily Report" off `report.kind`.
 *
 * Phase 5 (interactive present deck): when `activeSlide` is passed, ALL
 * slides stay mounted (never conditionally rendered -- see the doc comment
 * on `activeSlide` and ReportDeck.module.css) and every `<section>` gets
 * `data-active`. The `deckPaged` modifier class's `@media screen`-scoped
 * rule hides every slide except the active one on screen only; print media
 * never sees that rule, so `styles/print.css`'s existing slide rules apply
 * untouched and every page still prints regardless of which slide was
 * active when `window.print()` fired.
 *
 * WP1 (dynamic slide model): slide count/content is now driven entirely by
 * the `slides` prop (see `buildDeckSlides`, lib/deck-slides.ts) -- this
 * component itself no longer hardcodes "six slides." WP1's `buildDeckSlides`
 * always returns exactly today's six, so rendered output (on screen and
 * printed) is byte-identical to before this refactor.
 */
export function ReportDeck({ report, slides, activeSlide }: ReportDeckProps) {
  const paged = activeSlide !== undefined;

  // `data-active` is only meaningful once the deck is paged -- `undefined`
  // omits the attribute entirely, so an un-paged deck's DOM stays
  // byte-identical to pre-Phase-5.
  const isActive = (index: number): boolean | undefined => (paged ? index === activeSlide : undefined);

  return (
    <div className={`${styles.deck} deck ${paged ? styles.deckPaged : ''}`} style={deckVars}>
      {slides.map((slide, i) => (
        <section
          key={slide.key}
          className={`${styles.slide} slide ${slideSectionClass(slide.body.type)}`}
          data-active={isActive(i)}
        >
          {renderSlideBody(slide.body, report)}
        </section>
      ))}
    </div>
  );
}
