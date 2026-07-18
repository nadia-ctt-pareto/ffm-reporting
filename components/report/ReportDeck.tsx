'use client';

import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, riskTone, taskTone } from '@/lib/report-utils';
import type { Report } from '@/lib/types';
import styles from './ReportDeck.module.css';

export interface ReportDeckProps {
  report: Report;
}

// Fixed slide geometry -- the single source of truth for both the CSS (fed
// in via custom properties on `.deck`, see the inline style below) and any
// JS math that needs to know deck dimensions (the present page's
// responsive on-screen fit-scaling, and ReportScreen's PDF-preview
// thumbnail sizing). Never hardcode 1280/720/6 anywhere else.
export const DECK_SLIDE_WIDTH = 1280;
export const DECK_SLIDE_HEIGHT = 720;
export const DECK_SLIDE_COUNT = 6;
/** Screen-only vertical gap between stacked slides; print.css zeroes this to avoid a stray blank page. */
export const DECK_SLIDE_GAP = 32;
export const DECK_TOTAL_HEIGHT = DECK_SLIDE_HEIGHT * DECK_SLIDE_COUNT + DECK_SLIDE_GAP * (DECK_SLIDE_COUNT - 1);

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
 */
export function ReportDeck({ report }: ReportDeckProps) {
  const { onSched, total } = onSchedule(report);
  const blockers = openBlockers(report);
  const weekLabel = fmtWeekLabel(report.weekStart, report.weekEnd);

  const taskRows = report.tasks.map((t) => ({
    client: t.client,
    task: t.task,
    status: <Badge tone={taskTone(t.status)}>{t.status}</Badge>,
    deadline: fmtDateShort(t.deadline),
  }));

  return (
    <div className={`${styles.deck} deck`} style={deckVars}>
      {/* Slide 1 -- Cover */}
      <section className={`${styles.slide} slide ${styles.cover}`}>
        <div className={styles.coverDiagonal} aria-hidden="true" />
        <div className={styles.coverTop}>
          <div className={styles.coverKicker}>Weekly Report</div>
          <h1 className={styles.coverWeek}>{weekLabel}</h1>
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
      <section className={`${styles.slide} slide ${styles.padded}`}>
        <div className={styles.kicker}>This Week</div>
        <p className={styles.narrative}>{report.summaryNarrative}</p>
        <div className={styles.statsGrid}>
          <StatCard label="Client Calls" value={String(report.touchpoints.calls || 0)} />
          <StatCard label="Emails" value={String(report.touchpoints.emails || 0)} />
          <StatCard label="Escalations" value={String(report.touchpoints.escalations || 0)} />
        </div>
        {report.touchpoints.narrative ? <p className={styles.caption}>{report.touchpoints.narrative}</p> : null}
      </section>

      {/* Slide 3 -- Task Status */}
      <section className={`${styles.slide} slide ${styles.padded}`}>
        <div className={styles.kicker}>Task Status</div>
        <div className={styles.tableWrap}>
          <Table columns={TASK_COLUMNS} rows={taskRows} dense />
        </div>
        <div className={styles.slideFootnote}>
          {onSched} / {total} tasks on schedule &middot; {blockers} open blocker{blockers === 1 ? '' : 's'}
        </div>
      </section>

      {/* Slide 4 -- Risks & Blockers */}
      <section className={`${styles.slide} slide ${styles.padded}`}>
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
      <section className={`${styles.slide} slide ${styles.padded}`}>
        <div className={styles.kicker}>{"Next Week's Priorities"}</div>
        <ol className={styles.priorityList}>
          {report.priorities.map((p) => (
            <li key={p.id} className={styles.priorityItem}>
              {p.text}
            </li>
          ))}
        </ol>
      </section>

      {/* Slide 6 -- The Win */}
      <section className={`${styles.slide} slide ${styles.win}`}>
        <div className={styles.kicker}>The Win</div>
        <div className={styles.winStat}>{report.win.stat || '—'}</div>
        <div className={styles.winLabel}>{report.win.label}</div>
        <p className={styles.winNarrative}>{report.win.narrative}</p>
      </section>
    </div>
  );
}
