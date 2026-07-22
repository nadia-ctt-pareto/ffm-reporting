// WP1 of a larger "dynamic deck" plan made the branded report deck's slide
// list DATA instead of hardcoded JSX, without changing what actually
// rendered -- `buildDeckSlides` returned exactly the same six slides, for
// both report kinds, in the same order ReportDeck.tsx used to hardcode. That
// was a deliberately SAFE refactor with zero content changes, see this
// repo's print-page-count contract in styles/print.css and CLAUDE.md's
// "Report screen & presentation deck" section.
//
// WP2 is the payoff: `buildDeckSlides` now branches on `report.kind` for
// real. A WEEKLY report is a week with a roll-up, a win, and next-week
// priorities -- a narrative arc -- so it keeps WP1's exact six slides
// (Cover, Summary, Task Status, Risks & Blockers, Priorities, The Win),
// byte-for-byte unchanged. A DAILY report's defining nature is breadth
// across every client in a single day, not a weekly story -- so it gets a
// distinct slide list: Cover, an at-a-glance summary ("glance"), tasks
// broken out BY CLIENT ("tasksByClient") instead of one flat list, Risks &
// Blockers (retitled per SECTION_HEADINGS), Priorities (retitled), and a
// Win slide that's now CONDITIONAL -- omitted entirely when the day simply
// didn't produce one (see `hasWin`, lib/report-sections.ts). Section
// wording for both kinds lives in `SECTION_HEADINGS` (lib/report-sections.ts)
// -- this file only decides slide ORDER/PRESENCE and which body payload
// each slide carries; `ReportDeck.tsx` renders `slide.title` verbatim rather
// than re-deciding per-kind wording itself, so there is exactly one place
// ("This Week" vs. "Day at a Glance", etc.) that decision is made.
//
// Deliberately no React import and no `'use client'` -- this must stay a
// plain, framework-free function of `AnyReport`. See `buildDeckSlides`'s own
// doc comment for why that's load-bearing, not just tidiness. `hasWin` and
// `groupTasksByClient` (lib/report-sections.ts) are themselves pure
// functions of their arguments, so importing them here doesn't threaten
// that purity.

import { groupTasksByClient, hasWin, SECTION_HEADINGS, type ClientTaskGroup } from './report-sections';
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
 * `cover` / `summary` / `glance` / `win` carry no extra data on purpose:
 * those slide bodies read straight off the full `report` object (title,
 * prepared for/by, the win stat/label/narrative, touchpoints counts, ...)
 * exactly like before -- there is nothing to chunk about a cover, a single
 * summary paragraph, or a single win. `tasks` / `tasksByClient` / `risks` /
 * `priorities` are the sections a long report could eventually need to
 * split across slides, so they carry their own row subset (`rows`/`groups`)
 * even though no chunking threshold exists yet -- every section always gets
 * exactly one slide holding every row/group.
 *
 * WP2: `glance` (a daily-only at-a-glance summary slide, see
 * `buildDeckSlides`) and `tasksByClient` (a daily-only per-client task
 * breakdown, see `groupTasksByClient`, lib/report-sections.ts -- a weekly
 * report keeps the flat `tasks` slide, since a weekly's methodology is a
 * single roll-up, not a per-client breakdown) are new. `tasksByClient`
 * mirrors `tasks`'s `showFootnote` field for the exact same reason: a
 * future chunked "Tasks by Client" continuation slide must still be able to
 * show the whole-report on-schedule/blocker footnote only on its LAST
 * chunk.
 */
export type DeckSlideBody =
  | { type: 'cover' }
  | { type: 'summary' }
  | { type: 'glance' }
  | { type: 'tasks'; rows: Task[]; showFootnote: boolean }
  | { type: 'tasksByClient'; groups: ClientTaskGroup[]; showFootnote: boolean }
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
   * Task Status chunk). No chunking exists yet, so every key here is just
   * the section name -- 'cover', 'summary'/'glance', 'tasks'/'tasksByClient'
   * (WP2: the same `'tasks'` key is reused for a daily's client-grouped
   * slide -- weekly and daily slide lists are never rendered side by side,
   * so there's no collision risk, and reusing the key keeps present-page
   * deep-link/keyboard-jump logic kind-agnostic), 'risks', 'priorities',
   * 'win'.
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
 * A WEEKLY report keeps WP1's exact six slides, unconditionally, in the same
 * fixed order the old hardcoded JSX rendered them: Cover, Summary, Task
 * Status, Risks & Blockers, Priorities, The Win. No chunking threshold
 * exists yet -- `tasks`/`risks`/`priorities` each always get exactly one
 * slide holding every row, `showFootnote`/`startIndex` are always the
 * "only chunk" values (`true` / `1`).
 *
 * A DAILY report (WP2) gets a slide list that matches what a single day
 * spanning every client actually is: Cover, an at-a-glance summary
 * ("glance"), tasks broken out BY CLIENT ("tasksByClient" -- see
 * `groupTasksByClient`, lib/report-sections.ts) instead of one flat list,
 * Risks & Blockers (retitled "Blockers Needing Attention" per
 * `SECTION_HEADINGS`), Priorities (retitled "Tomorrow & Follow-Ups"), and a
 * Win slide that's OMITTED ENTIRELY when `hasWin(report)` is false -- unlike
 * a weekly, which always gets a Win slide even when its stat/label/
 * narrative are blank (the deck's existing `'—'` stat fallback handles
 * that case, and a weekly report having "no win this week" is itself
 * meaningful status to surface). This is the one place slide COUNT
 * genuinely varies by content today, ahead of any pagination/chunking work:
 * `PresentScreen`'s navigator (dot count, `1-6` keyboard jump range, "n / N"
 * counter) and the print-page-count contract (styles/print.css) both
 * already derive everything from `slides.length`, so a 5-slide daily prints
 * as a 5-page PDF with zero extra plumbing -- see
 * scripts/verify-deck-print.ts's `daily-no-win` fixture, which asserts
 * exactly this end-to-end.
 *
 * `hasWin`/`groupTasksByClient` are pure functions of `report` alone (see
 * lib/report-sections.ts), so branching on them here doesn't threaten this
 * function's own "pure function of `report`" contract.
 */
export function buildDeckSlides(report: AnyReport): DeckSlide[] {
  const headings = SECTION_HEADINGS[report.kind];

  if (report.kind === 'daily') {
    const slides: DeckSlide[] = [
      { key: 'cover', title: 'Cover', part: null, body: { type: 'cover' } },
      { key: 'summary', title: headings.summary, part: null, body: { type: 'glance' } },
      {
        key: 'tasks',
        title: headings.tasks,
        part: null,
        body: { type: 'tasksByClient', groups: groupTasksByClient(report.tasks), showFootnote: true },
      },
      { key: 'risks', title: headings.risks, part: null, body: { type: 'risks', rows: report.risks } },
      {
        key: 'priorities',
        title: headings.priorities,
        part: null,
        body: { type: 'priorities', rows: report.priorities, startIndex: 1 },
      },
    ];
    // The one genuinely content-dependent slide-count branch in this
    // function: a daily report with no recorded win gets no Win slide at
    // all, rather than a slide showing an empty '—' stat (which would read
    // as "there IS a win, but it's blank" instead of "no win today").
    if (hasWin(report)) {
      slides.push({ key: 'win', title: headings.win, part: null, body: { type: 'win' } });
    }
    return slides;
  }

  return [
    { key: 'cover', title: 'Cover', part: null, body: { type: 'cover' } },
    { key: 'summary', title: headings.summary, part: null, body: { type: 'summary' } },
    {
      key: 'tasks',
      title: headings.tasks,
      part: null,
      body: { type: 'tasks', rows: report.tasks, showFootnote: true },
    },
    { key: 'risks', title: headings.risks, part: null, body: { type: 'risks', rows: report.risks } },
    {
      key: 'priorities',
      title: headings.priorities,
      part: null,
      body: { type: 'priorities', rows: report.priorities, startIndex: 1 },
    },
    { key: 'win', title: headings.win, part: null, body: { type: 'win' } },
  ];
}
