'use client';

import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort } from '@/lib/format';
import { onSchedule, openBlockers, reportPeriodLabel, riskTone, taskTone } from '@/lib/report-utils';
import type { AnyReport } from '@/lib/types';
import styles from './ReportDeck.module.css';

export interface ReportDeckProps {
  report: AnyReport;
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
// two-axis fit-scaling). Never hardcode 1280/720/6 anywhere else.
export const DECK_SLIDE_WIDTH = 1280;
export const DECK_SLIDE_HEIGHT = 720;
export const DECK_SLIDE_COUNT = 6;
/** Screen-only vertical gap between stacked slides; print.css zeroes this to avoid a stray blank page. Still consumed by `deckVars` below (the un-paged, all-slides-stacked rendering path). */
export const DECK_SLIDE_GAP = 32;
/** Single source for the present-page navigator's dot `aria-label`s -- length must equal DECK_SLIDE_COUNT. */
export const DECK_SLIDE_TITLES: readonly string[] = ['Cover', 'Summary', 'Task Status', 'Risks & Blockers', 'Priorities', 'The Win'];

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
 * The branded 6-slide report deck. Rendered verbatim by BOTH the bare
 * `/reports/[id]/present` route (full size, for on-screen viewing and
 * browser print-to-PDF) and the scaled-down PDF-preview strip on
 * `ReportScreen` -- one component, guaranteed screen/print/preview parity.
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
 * Phase 5 (interactive present deck): when `activeSlide` is passed, ALL 6
 * slides stay mounted (never conditionally rendered -- see the doc comment
 * on `activeSlide` and ReportDeck.module.css) and every `<section>` gets
 * `data-active`. The `deckPaged` modifier class's `@media screen`-scoped
 * rule hides every slide except the active one on screen only; print media
 * never sees that rule, so `styles/print.css`'s existing slide rules apply
 * untouched and all 6 pages still print regardless of which slide was
 * active when `window.print()` fired.
 */
export function ReportDeck({ report, activeSlide }: ReportDeckProps) {
  const { onSched, total } = onSchedule(report);
  const blockers = openBlockers(report);
  const periodLabel = reportPeriodLabel(report);
  const paged = activeSlide !== undefined;

  const taskRows = report.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  // `data-active` is only meaningful once the deck is paged -- `undefined`
  // omits the attribute entirely, so an un-paged deck's DOM stays
  // byte-identical to pre-Phase-5.
  const isActive = (index: number): boolean | undefined => (paged ? index === activeSlide : undefined);

  return (
    <div className={`${styles.deck} deck ${paged ? styles.deckPaged : ''}`} style={deckVars}>
      {/* Slide 1 -- Cover */}
      <section className={`${styles.slide} slide ${styles.cover}`} data-active={isActive(0)}>
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
            {/* Regonia isn't self-hosted yet (see typography.css) -- this
                falls back to Didot/Bodoni/serif, which is acceptable for
                MVP. A licensed Regonia woff2 via next/font/local is a
                one-file add later. */}
            <div className={styles.coverHeroStat}>{report.win.stat}</div>
            <div className={styles.coverHeroLabel}>{report.win.label}</div>
          </div>
        ) : null}
      </section>

      {/* Slide 2 -- Summary + touchpoints */}
      <section className={`${styles.slide} slide ${styles.padded}`} data-active={isActive(1)}>
        <div className={styles.kicker}>{report.kind === 'daily' ? 'Today' : 'This Week'}</div>
        <p className={styles.narrative}>{report.summaryNarrative}</p>
        <div className={styles.statsGrid}>
          <StatCard label="Client Calls" value={String(report.touchpoints.calls || 0)} />
          <StatCard label="Emails" value={String(report.touchpoints.emails || 0)} />
          <StatCard label="Escalations" value={String(report.touchpoints.escalations || 0)} />
        </div>
        {report.touchpoints.narrative ? <p className={styles.caption}>{report.touchpoints.narrative}</p> : null}
      </section>

      {/* Slide 3 -- Task Status */}
      <section className={`${styles.slide} slide ${styles.padded}`} data-active={isActive(2)}>
        <div className={styles.kicker}>Task Status</div>
        <div className={styles.tableWrap}>
          <Table columns={TASK_COLUMNS} rows={taskRows} dense />
        </div>
        <div className={styles.slideFootnote}>
          {onSched} / {total} tasks on schedule &middot; {blockers} open blocker{blockers === 1 ? '' : 's'}
        </div>
      </section>

      {/* Slide 4 -- Risks & Blockers */}
      <section className={`${styles.slide} slide ${styles.padded}`} data-active={isActive(3)}>
        <div className={styles.kicker}>{'Risks & Blockers'}</div>
        {report.risks.length > 0 ? (
          <div className={styles.riskGrid}>
            {report.risks.map((rk) => (
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
      </section>

      {/* Slide 5 -- Priorities */}
      <section className={`${styles.slide} slide ${styles.padded}`} data-active={isActive(4)}>
        <div className={styles.kicker}>{report.kind === 'daily' ? 'Priorities' : "Next Week's Priorities"}</div>
        <ol className={styles.priorityList}>
          {report.priorities.map((p) => (
            <li key={p.id} className={styles.priorityItem}>
              {p.text}
            </li>
          ))}
        </ol>
      </section>

      {/* Slide 6 -- The Win */}
      <section className={`${styles.slide} slide ${styles.win}`} data-active={isActive(5)}>
        <div className={styles.kicker}>The Win</div>
        <div className={styles.winStat}>{report.win.stat || '—'}</div>
        <div className={styles.winLabel}>{report.win.label}</div>
        <p className={styles.winNarrative}>{report.win.narrative}</p>
      </section>
    </div>
  );
}
