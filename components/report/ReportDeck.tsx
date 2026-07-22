'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';
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
   * Phase 8d (deck slide model): the ordered slide list, built by
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
 * treatment (flex column + 88/96px padding), same as before Phase 8d (deck slide model)'s refactor.
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
 * The shared section kicker -- e.g. "Task Status" -- now Phase 8d (deck pagination)-aware: when
 * `slide.part` is non-null (a section that spans more than one physical
 * slide), it appends an explicit, muted "· 2 of 3" part affordance
 * (`.kickerPart`) so a viewer landing on a continuation slide immediately
 * understands it's a CONTINUATION of the previous one, not a new section.
 * `compact` selects `.kickerCompact` instead of `.kicker` -- used ONLY by
 * the daily "Tasks by Client" slide (see `slideSectionClass`'s sibling
 * comment on why that slide needs the tighter variant); every other section
 * uses the plain `.kicker`. A single-slide section (`slide.part === null`,
 * the overwhelmingly common case -- most reports never overflow at all)
 * renders byte-identical to every pre-Phase 8d (deck pagination) kicker.
 */
function SlideKicker({ slide, compact = false }: { slide: DeckSlide; compact?: boolean }) {
  return (
    <div className={compact ? styles.kickerCompact : styles.kicker}>
      {slide.title}
      {slide.part ? (
        <span className={styles.kickerPart}>
          {' '}
          &middot; {slide.part.index} of {slide.part.total}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Renders one slide's body (the JSX that used to live inline inside each of
 * the six hardcoded `<section>` blocks pre-Phase 8d (deck slide model), moved verbatim). `report` is
 * still threaded through alongside `slide` -- the `cover` branch reads
 * report fields directly (title/prepared-for/-by), exactly like before. The
 * `tasks`/`tasksByClient` branches also read full-report on-schedule/blocker
 * counts via `onSchedule`/`openBlockers` for their footnote -- deliberately
 * from `report.tasks`, NOT from `body.rows`/`body.groups` -- because a
 * chunked Task Status deck (Phase 8d (deck pagination)) keeps showing the same whole-report counts
 * on every chunk (only the LAST chunk shows the footnote at all, per
 * `body.showFootnote`), not a per-chunk subset that would silently
 * under-count.
 *
 * Phase 8d (deck pagination): `summary`/`glance`/`win` no longer read `report.summaryNarrative`/
 * `report.win.narrative` directly -- they render `body.narrative`, THIS
 * SLIDE'S chunk of that text (see `chunkNarrative`, lib/deck-slides.ts), and
 * gate the StatCard trio / touchpoints caption / win stat+label on
 * `body.showStats`/`body.showStat` (`true` on a section's first chunk only
 * -- those are fixed blocks, not flowing text, so they never repeat on a
 * continuation slide).
 *
 * Phase 8d (per-kind sections): takes the whole `slide` (not just `body`) so every section's kicker
 * can render `slide.title` verbatim instead of re-deciding per-kind wording
 * here -- `SECTION_HEADINGS` (lib/report-sections.ts), via `buildDeckSlides`,
 * is the ONE place that decision gets made; this function must never
 * re-introduce a `report.kind === 'daily' ? ... : ...` wording ternary for a
 * section heading. The one deliberate EXCEPTION is the risks section's
 * EMPTY-STATE copy ("No blockers today." vs. "No open risks this week.") --
 * that's body copy for an absent-data state, not a section heading, so it
 * isn't part of `SECTION_HEADINGS`'s contract and is decided inline below.
 */
function renderSlideBody(slide: DeckSlide, report: AnyReport): ReactNode {
  const { body } = slide;
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

    // Phase 8d (deck pagination): `body.narrative` is THIS SLIDE'S chunk of `report.summaryNarrative`
    // (see `chunkNarrative`, lib/deck-slides.ts) -- never the full field
    // directly, so a long narrative's continuation slides each show their
    // own portion instead of the whole thing repeating (or clipping) on
    // every chunk. `body.showStats` is `true` only on the section's FIRST
    // chunk: the StatCard trio + touchpoints caption are a FIXED block, not
    // flowing text, so they belong on chunk 1 only -- a continuation slide
    // is narrative-only, matching `summaryFirstChunkBudget`'s smaller
    // reserved budget on that first chunk.
    case 'summary':
      return (
        <>
          <SlideKicker slide={slide} />
          <p className={styles.narrative}>{body.narrative}</p>
          {body.showStats ? (
            <>
              <div className={styles.statsGrid}>
                <StatCard label="Client Calls" value={String(report.touchpoints.calls || 0)} />
                <StatCard label="Emails" value={String(report.touchpoints.emails || 0)} />
                <StatCard label="Escalations" value={String(report.touchpoints.escalations || 0)} />
              </div>
              {report.touchpoints.narrative ? <p className={styles.caption}>{report.touchpoints.narrative}</p> : null}
            </>
          ) : null}
        </>
      );

    // Phase 8d (per-kind sections): the daily-only "Day at a Glance" slide. Unlike the weekly
    // `summary` slide (whose stats are the touchpoint counts alone), a
    // day's "glance" leads with the same on-schedule/blocker stats the
    // report screen already surfaces up top -- a single day's headline
    // isn't "how many calls did we make," it's "are today's tasks on
    // track" -- with Client Calls kept as the third card so touchpoint
    // volume is still visible at a glance. Reuses `.narrative`/
    // `.statsGrid`/`.caption` verbatim (no new CSS): the "glance" slide
    // is structurally the same shape as `summary`, just a different stat
    // mix and kicker. Phase 8d (deck pagination): same `body.narrative`/`body.showStats` chunking
    // contract as `summary` above.
    case 'glance': {
      const { onSched, total } = onSchedule(report);
      return (
        <>
          <SlideKicker slide={slide} />
          <p className={styles.narrative}>{body.narrative}</p>
          {body.showStats ? (
            <>
              <div className={styles.statsGrid}>
                <StatCard label="Tasks On Schedule" value={`${onSched} / ${total}`} />
                <StatCard label="Open Blockers" value={String(openBlockers(report))} />
                <StatCard label="Client Calls" value={String(report.touchpoints.calls || 0)} />
              </div>
              {report.touchpoints.narrative ? <p className={styles.caption}>{report.touchpoints.narrative}</p> : null}
            </>
          ) : null}
        </>
      );
    }

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
          <SlideKicker slide={slide} />
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

    // Phase 8d (per-kind sections): the daily-only "Tasks by Client" slide -- a daily report's
    // defining nature is breadth across every client in one day, so its
    // task section is organized BY CLIENT (a compact divider row ahead of
    // each client's own task rows, no Client column since the divider
    // already carries that) rather than one flat list with a repeating
    // Client column (the weekly `tasks` slide, above, keeps that flat
    // shape -- a weekly's methodology is a single roll-up, not a
    // per-client breakdown). The footnote reads the exact same
    // whole-report `onSchedule`/`openBlockers` counts as the `tasks`
    // branch, for the identical "future chunk" reason documented on this
    // function's own doc comment.
    //
    // Deliberately hand-rolled (ONE `<table>`, ONE `<thead>`) instead of
    // rendering the shared `components/ui/Table` primitive once per client
    // group. A daily commonly spans 4-6+ distinct clients (this repo's
    // seed data alone does), and this slide has a FIXED 720px height
    // (`.slide { overflow: hidden }`) -- N independent tables would mean N
    // repeated header rows, which is real, measured height that a
    // realistic multi-client daily cannot afford without spilling content
    // silently past the slide's clipped edge. `ReportScreen.tsx`'s
    // equivalent section is an ordinary scrollable document with no such
    // budget, so it correctly DOES render one full `<Table>` per client
    // (see that file) -- this is a print-geometry-driven divergence
    // between the two renderers, not a stylistic inconsistency. Verified
    // against scripts/verify-deck-print.ts's `baseline-daily` (4 clients)
    // and `daily-no-win` (6 clients) fixtures, both of which pass the
    // print-media clipping assertion with this layout; `daily-many-clients`
    // (6 clients x 4 tasks each = 24 rows) still legitimately overflows --
    // that remaining case is real pagination's job (a later work package),
    // not something a denser layout alone can solve, exactly like the two
    // purely-weekly overflow fixtures.
    case 'tasksByClient': {
      const { onSched, total } = onSchedule(report);
      const blockers = openBlockers(report);
      return (
        <>
          {/* `.kickerCompact` (not the shared `.kicker`) -- see its own doc
              comment in ReportDeck.module.css for why this slide alone
              needs a tighter kicker margin, and why that's safe to do
              without touching `.kicker` itself (every other slide,
              including the weekly `tasks` slide, must stay byte-identical). */}
          <SlideKicker slide={slide} compact />
          <div className={styles.tableWrap}>
            <table className={styles.groupedTable}>
              <thead>
                <tr>
                  <th className={styles.groupedTh}>Task</th>
                  <th className={styles.groupedTh}>Status</th>
                  <th className={styles.groupedTh}>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {body.groups.map((group) => (
                  // `Fragment` (not a wrapping `<div>`) -- a `<div>` isn't a
                  // valid direct child of `<tbody>`; the divider row +
                  // that client's task rows must all be sibling `<tr>`s.
                  <Fragment key={group.client}>
                    <tr>
                      <td className={styles.clientGroupCell} colSpan={3}>
                        {group.client}
                      </td>
                    </tr>
                    {group.tasks.map((t) => (
                      <tr key={t.id}>
                        <td className={styles.groupedTd}>{t.task}</td>
                        <td className={styles.groupedTd}>
                          <Badge tone={taskTone(t.status)}>{t.status}</Badge>
                        </td>
                        <td className={styles.groupedTd}>{fmtDateShort(t.deadline)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {body.showFootnote ? (
            // `.slideFootnoteCompact` (not the shared `.slideFootnote`) --
            // same reasoning as `.kickerCompact` above: this slide alone
            // needs a tighter top margin, without touching the class the
            // weekly `tasks` slide's identical footnote reuses.
            <div className={styles.slideFootnoteCompact}>
              {onSched} / {total} tasks on schedule &middot; {blockers} open blocker{blockers === 1 ? '' : 's'}
            </div>
          ) : null}
        </>
      );
    }

    case 'risks':
      return (
        <>
          <SlideKicker slide={slide} />
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
            // Phase 8d (per-kind sections): kind-aware empty-state copy -- "No blockers today." reads
            // naturally for a single day; the pre-existing weekly copy is
            // untouched. Deliberately inline here rather than in
            // SECTION_HEADINGS -- see this function's own doc comment for
            // why this one ternary survives.
            <div className={styles.mutedNote}>{report.kind === 'daily' ? 'No blockers today.' : 'No open risks this week.'}</div>
          )}
        </>
      );

    case 'priorities':
      return (
        <>
          <SlideKicker slide={slide} />
          <ol className={styles.priorityList}>
            {body.rows.map((p, i) => (
              <li key={p.id} className={styles.priorityItem}>
                {/* Phase 8d (deck slide model): an explicit running number (`startIndex + i`) instead
                    of the old CSS `counter(priority)` -- see
                    ReportDeck.module.css's `.priorityNum` for why the CSS
                    counter approach had to go (it silently restarts at 1 on
                    every slide, which would misnumber a chunked priorities
                    continuation slide). Phase 8d (deck pagination): `startIndex` now genuinely
                    varies per chunk (`chunkPriorities`, lib/deck-slides.ts) --
                    this is the payoff that comment was written ahead of. */}
                <span className={styles.priorityNum}>{body.startIndex + i}.</span>
                {p.text}
              </li>
            ))}
          </ol>
        </>
      );

    // Phase 8d (deck pagination): `body.narrative` is THIS SLIDE'S chunk of `report.win.narrative`
    // (see `buildWinSlides`, lib/deck-slides.ts). `body.showStat` is `true`
    // only on the section's FIRST chunk -- the win stat + label are a FIXED
    // block, not flowing text, so a continuation slide shows only the
    // kicker (with its "· 2 of 2" part affordance) and the narrative
    // continuation, never a repeated (or blank) stat/label.
    case 'win':
      return (
        <>
          <SlideKicker slide={slide} />
          {body.showStat ? (
            <>
              <div className={styles.winStat}>{report.win.stat || '—'}</div>
              <div className={styles.winLabel}>{report.win.label}</div>
            </>
          ) : null}
          <p className={styles.winNarrative}>{body.narrative}</p>
        </>
      );

    default: {
      // Exhaustiveness guard: if a future work package adds a new
      // `DeckSlideBody` variant without a matching render branch here, this
      // line fails to compile (`body` can no longer be assigned to `never`)
      // instead of silently rendering nothing for that slide type.
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
 * Phase 8d (deck slide model): slide count/content is driven entirely by the
 * `slides` prop (see `buildDeckSlides`, lib/deck-slides.ts) -- this
 * component itself never hardcodes a slide count or a section's wording.
 * Phase 8d (per-kind sections): `buildDeckSlides` now returns a genuinely different slide list per
 * `report.kind` (a weekly's fixed six vs. a daily's five-or-six, see that
 * function's own doc comment) -- this component didn't have to change AT
 * ALL to support that, beyond `renderSlideBody` gaining two new body-type
 * branches (`glance`, `tasksByClient`) and reading `slide.title` instead of
 * a hardcoded/ternary kicker string. That's the entire point of the
 * slides-as-data model: slide count/order/wording all live in
 * `buildDeckSlides`, and this component just renders whatever list it's
 * handed, in order.
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
          {renderSlideBody(slide, report)}
        </section>
      ))}
    </div>
  );
}
