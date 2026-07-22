// WP1 of a larger "dynamic deck" plan: makes the branded report deck's slide
// list DATA instead of hardcoded JSX, without changing what actually renders
// -- `buildDeckSlides` below always returns exactly today's six slides, for
// both report kinds, in the same order ReportDeck.tsx used to render them
// unconditionally. This is a deliberately SAFE refactor: the on-screen deck
// and the printed PDF stay byte-identical (still exactly 6 slides, still
// exactly 6 pages) -- see this repo's print-page-count contract in
// styles/print.css and CLAUDE.md's "Report screen & presentation deck"
// section. Later work packages will make the slide count actually vary (a
// long task list chunking across multiple Task Status slides, an
// at-a-glance summary slide, etc.) -- none of that is built here; this
// module only establishes the shape those future slides will plug into.
//
// Deliberately no React import and no `'use client'` -- this must stay a
// plain, framework-free function of `AnyReport`. See `buildDeckSlides`'s own
// doc comment for why that's load-bearing, not just tidiness.

import type { AnyReport, Priority, Risk, Task } from './types';

/**
 * 1-based position of a slide within a multi-slide "chunk" of a single
 * report section (e.g. a Task Status list long enough to spill across three
 * slides -- not built until a later work package). `index`/`total` are both
 * 1-based so `${index} of ${total}` reads naturally in an aria-label. A
 * section that fits on one slide (every section, for every report, in WP1 --
 * no chunking logic exists yet) carries `part: null` on its one and only
 * slide.
 */
export interface SlidePart {
  index: number;
  total: number;
}

/**
 * The data a slide's body needs to render. This is what used to be read
 * directly off `report` inline inside each of ReportDeck.tsx's six hardcoded
 * `<section>` blocks -- now it's an explicit, typed payload so a future
 * chunked section only has to change WHICH rows it hands to each slide, not
 * how ReportDeck renders a slide of that type.
 *
 * `cover` / `summary` / `win` carry no extra data on purpose: those three
 * slide bodies read straight off the full `report` object (title, prepared
 * for/by, the win stat/label/narrative, touchpoints counts, ...) exactly
 * like before -- there is nothing to chunk about a cover, a single summary
 * paragraph, or a single win. `tasks` / `risks` / `priorities` are the three
 * sections a long report could eventually need to split across slides, so
 * they carry their own row subset (`rows`) even though WP1 always hands
 * every row from `report` to a single slide.
 *
 * A later work package's plan adds `{ type: 'glance' }` (an at-a-glance
 * summary slide) and `{ type: 'tasksByClient'; groups: ClientTaskGroup[];
 * showFootnote: boolean }` -- deliberately not implemented here; naming them
 * in this comment only so a future diff extending this union doesn't have to
 * rediscover them.
 */
export type DeckSlideBody =
  | { type: 'cover' }
  | { type: 'summary' }
  | { type: 'tasks'; rows: Task[]; showFootnote: boolean }
  | { type: 'risks'; rows: Risk[] }
  | { type: 'priorities'; rows: Priority[]; startIndex: number }
  | { type: 'win' };

export interface DeckSlide {
  /**
   * Stable identity for this slide -- used as ReportDeck's React `key` AND
   * as the present-page navigator's per-dot identity (`key={slide.key}`,
   * replacing the old `key={title}` -- a title alone stops being unique the
   * moment two chunks of the same section share a title). Also doubles as a
   * natural slide anchor/log label (e.g. a future `'tasks-2'` for the second
   * Task Status chunk). WP1 never chunks, so every key here is just the
   * section name ('cover', 'summary', 'tasks', 'risks', 'priorities', 'win').
   */
  key: string;
  /** Present-page navigator dot `aria-label` text, e.g. "Task Status" -- verbatim what the deleted `DECK_SLIDE_TITLES` used to hold. */
  title: string;
  /** Non-null only once a section spans more than one slide (a later work package). Always `null` in WP1 -- no section is ever chunked yet. */
  part: SlidePart | null;
  body: DeckSlideBody;
}

/**
 * Builds the ordered slide list for a report.
 *
 * MUST stay a pure function of `report` alone -- no `Date.now()`, no
 * `Math.random()`, no environment read (`window`, `process.env`, a feature
 * flag, ...). `PresentScreen` calls this from a `useMemo` keyed only on
 * `report`, but the token-share path resolves `report` server-side before
 * `PresentScreen` ever mounts (see `app/reports/[id]/present/page.tsx`'s
 * `resolveShared`) -- a future phase could lift this same call onto that
 * server pass to avoid a client-side layout flash. If the function's output
 * ever depended on anything besides its `report` argument, the server pass
 * and the client pass could disagree and produce a React hydration
 * mismatch -- exactly the class of bug hydration warnings exist to catch.
 * Keep it boring and deterministic.
 *
 * WP1 returns exactly today's six slides, unconditionally, for both weekly
 * and daily reports, in the same fixed order the old hardcoded JSX rendered
 * them: Cover, Summary, Task Status, Risks & Blockers, Priorities, The Win.
 * No chunking threshold exists yet -- `tasks`/`risks`/`priorities` each
 * always get exactly one slide holding every row, `showFootnote`/
 * `startIndex` are always the "only chunk" values (`true` / `1`). This
 * function exists so `ReportDeck`/`PresentScreen` can already be written
 * against a slide-count-agnostic contract before any report actually needs
 * more than six slides.
 */
export function buildDeckSlides(report: AnyReport): DeckSlide[] {
  return [
    { key: 'cover', title: 'Cover', part: null, body: { type: 'cover' } },
    { key: 'summary', title: 'Summary', part: null, body: { type: 'summary' } },
    {
      key: 'tasks',
      title: 'Task Status',
      part: null,
      body: { type: 'tasks', rows: report.tasks, showFootnote: true },
    },
    { key: 'risks', title: 'Risks & Blockers', part: null, body: { type: 'risks', rows: report.risks } },
    {
      key: 'priorities',
      title: 'Priorities',
      part: null,
      body: { type: 'priorities', rows: report.priorities, startIndex: 1 },
    },
    { key: 'win', title: 'The Win', part: null, body: { type: 'win' } },
  ];
}
