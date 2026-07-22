// Phase 8d (deck slide model) of a larger "dynamic deck" plan made the branded report deck's slide
// list DATA instead of hardcoded JSX, without changing what actually
// rendered -- `buildDeckSlides` returned exactly the same six slides, for
// both report kinds, in the same order ReportDeck.tsx used to hardcode. That
// was a deliberately SAFE refactor with zero content changes, see this
// repo's print-page-count contract in styles/print.css and CLAUDE.md's
// "Report screen & presentation deck" section.
//
// Phase 8d (per-kind sections) is the payoff: `buildDeckSlides` now branches on `report.kind` for
// real. A WEEKLY report is a week with a roll-up, a win, and next-week
// priorities -- a narrative arc -- so it keeps Phase 8d (deck slide model)'s exact six slides
// (Cover, Summary, Task Status, Risks & Blockers, Priorities, The Win).
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
// Phase 8d (deck pagination) is the fix for a real, measured data-loss bug: every section here used
// to always get exactly ONE slide holding EVERY row, no matter how much
// content that was -- `.slide { overflow: hidden }` (ReportDeck.module.css)
// then silently CLIPPED whatever didn't fit, from both the on-screen deck
// and the exported PDF, with zero visible indication anything was missing.
// The harness this file is verified against (scripts/verify-deck-print.ts)
// measured up to 2,018px of tasks, 949px of risks, and 711px of summary
// PROSE overflowing a single 720px-tall slide on realistic fixtures. Phase 8d (deck pagination)
// makes every section CHUNK across as many continuation slides as its real
// content needs -- see `packIntoSlides` (structured sections: tasks/
// tasksByClient/risks/priorities) and `chunkNarrative` (prose sections:
// summary/glance/win) below. `buildDeckSlides` itself keeps its Phase 8d
// shape (branch on `report.kind`, assemble an ordered `DeckSlide[]`) -- it
// just now calls a per-section chunker instead of handing every row to one
// slide unconditionally.
//
// Deliberately no React import and no `'use client'` -- this must stay a
// plain, framework-free function of `AnyReport`. See `buildDeckSlides`'s own
// doc comment for why that's load-bearing, not just tidiness. `hasWin` and
// `groupTasksByClient` (lib/report-sections.ts) are themselves pure
// functions of their arguments, so importing them here doesn't threaten
// that purity -- and neither does Phase 8d's `estimateLines`/`packIntoSlides`/
// `chunkNarrative`, which are pure functions of their own arguments only
// (no `Date`, no `Math.random`, no environment read).

import { groupTasksByClient, hasWin, SECTION_HEADINGS, type ClientTaskGroup } from './report-sections';
import type { AnyReport, Priority, Risk, Task } from './types';

/**
 * 1-based position of a slide within a multi-slide "chunk" of a single
 * report section (e.g. a Task Status list long enough to spill across three
 * slides -- see Phase 8d's chunkers below). `index`/`total` are both 1-based so
 * `${index} of ${total}` reads naturally in an aria-label AND in the
 * on-slide "Task Status · 2 of 3" part affordance (ReportDeck.tsx's
 * `SlideKicker`, ReportDeck.module.css's `.kickerPart`). A section that fits
 * on one slide (the overwhelmingly common case -- most reports never
 * overflow at all) carries `part: null` on its one and only slide, exactly
 * as every section did before Phase 8d (deck pagination).
 */
export interface SlidePart {
  index: number;
  total: number;
}

/**
 * The data a slide's body needs to render. This is what used to be read
 * directly off `report` inline inside each of ReportDeck.tsx's six hardcoded
 * `<section>` blocks -- now it's an explicit, typed payload so a chunked
 * section only has to change WHICH rows it hands to each slide, not how
 * ReportDeck renders a slide of that type.
 *
 * `cover` carries no extra data on purpose: there is nothing to chunk about
 * a cover. `tasks` / `tasksByClient` / `risks` / `priorities` carry their own
 * row subset (`rows`/`groups`) -- Phase 8d (deck slide model) already shaped them this way in
 * anticipation of Phase 8d's chunking, so Phase 8d (deck pagination) needed ZERO shape changes here for
 * those four; only `buildDeckSlides` (below) changed, to actually populate
 * more than one slide's worth.
 *
 * Phase 8d (deck pagination): `summary` / `glance` / `win` gained real payloads for the first time
 * (Phase 8d read `report.summaryNarrative`/`report.win.narrative` straight
 * off `report` since a narrative was never split before). `narrative` is
 * THIS SLIDE'S chunk of text (never the full field -- see `chunkNarrative`),
 * and `showStats`/`showStat` is true only on a section's FIRST chunk: the
 * StatCard trio + touchpoints caption (summary/glance) and the win stat +
 * label (win) are FIXED blocks, not flowing text, so they belong on chunk 1
 * only -- a continuation slide is narrative-only (see
 * `summaryFirstChunkBudget`/`winFirstChunkBudget` below for why chunk 1's
 * available narrative budget is correspondingly SMALLER than a
 * continuation's).
 */
export type DeckSlideBody =
  | { type: 'cover' }
  | { type: 'summary'; narrative: string; showStats: boolean }
  | { type: 'glance'; narrative: string; showStats: boolean }
  | { type: 'tasks'; rows: Task[]; showFootnote: boolean }
  | { type: 'tasksByClient'; groups: ClientTaskGroup[]; showFootnote: boolean }
  | { type: 'risks'; rows: Risk[] }
  | { type: 'priorities'; rows: Priority[]; startIndex: number }
  | { type: 'win'; narrative: string; showStat: boolean };

export interface DeckSlide {
  /**
   * Stable identity for this slide -- used as ReportDeck's React `key` AND
   * as the present-page navigator's per-dot identity (`key={slide.key}`).
   * Phase 8d (deck pagination): a section that fits on one slide keeps the exact plain key it
   * always had ('cover', 'summary'/'glance', 'tasks'/'tasksByClient',
   * 'risks', 'priorities', 'win') -- byte-identical to Phase 8d, which is
   * what keeps every non-overflowing report's slide keys (and therefore its
   * present-page deep links) completely unaffected by this phase. Only once
   * a section genuinely spans more than one slide does the key become
   * `${section}-${1-based index}` (e.g. `tasks-2` for the second Task
   * Status chunk) -- see `slideKey` below.
   */
  key: string;
  /** Present-page navigator dot `aria-label` text, e.g. "Task Status" -- verbatim what the deleted `DECK_SLIDE_TITLES` used to hold. Identical across every chunk of the same section (the part affordance is carried separately via `part`, not baked into `title`). */
  title: string;
  /** Non-null only once a section spans more than one slide. `null` for every slide of a report that never overflows -- the overwhelmingly common case. */
  part: SlidePart | null;
  body: DeckSlideBody;
}

/**
 * Phase 8d (deck pagination): the fixed geometry constants every chunker below is built on.
 *
 * MEASUREMENT METHODOLOGY (read this before ever touching a number here) --
 * option (b) from the Phase 8d (deck pagination) plan, "deterministic height estimation":
 *   (a) a fixed rows-per-slide count was rejected as content-blind (a
 *       500-char task title wraps to ~10 lines and blows a fixed-count slide
 *       -- the exact silent-clip bug this phase fixes);
 *   (c) real DOM measurement (render, measure, re-chunk) was rejected
 *       TWICE over: the token-share path renders this deck SERVER-SIDE on
 *       the very first pass (`resolveShared` -> `PresentScreen`, SSR
 *       included) -- a measure-then-re-render pass would either
 *       hydration-mismatch or flash an unmeasured layout at the exact
 *       audience (anonymous share recipients) this artifact exists for;
 *       and `?print=1` fires `window.print()` after `fonts.ready` + one
 *       rAF -- a measurement-driven re-chunk racing that would have to be
 *       PROVABLY committed before `window.print()`'s synchronous DOM
 *       snapshot, resurrecting the exact bug class styles/print.css's
 *       header comment already documents at length. THERE IS NO
 *       MEASUREMENT FALLBACK IN THE SHIPPED CODE for either reason.
 *   (b) is (a) with per-row ESTIMATED heights: a pure function of the
 *       report, identical on server and client (no hydration risk), the
 *       print flow untouched, and unit-testable in a throwaway script.
 *
 * Every number below was measured against the REAL rendered deck, not
 * guessed or reasoned out from the CSS alone -- via a throwaway (uncommitted,
 * per this phase's own instructions) Node script driving `chrome-headless-
 * shell` over the DevTools Protocol, the same technique
 * scripts/verify-deck-print.ts uses: the dev server ran in demo mode, a
 * controlled multi-length fixture was seeded into `localStorage`, the
 * present route was loaded, and `Emulation.setEmulatedMedia({media:'print'})`
 * was set BEFORE reading `getBoundingClientRect()`/`getComputedStyle()` --
 * so every measurement reflects the actual print layout (unscaled, one slide
 * = 720px of real content height), not the on-screen fit-scaled/paginated
 * view.
 *
 * Two measurement techniques were used, depending on the element:
 *   - Elements with an EXPLICIT CSS line-height (`var(--leading-body)`, e.g.
 *     `.narrative`/`.riskDescription`/`.caption`/`.winNarrative`) resolve to
 *     a real pixel value directly via `getComputedStyle(el).lineHeight` --
 *     no extra calibration needed for the per-line height itself.
 *   - Elements whose line-height computes to the CSS keyword `'normal'`
 *     (`.td` task-title cells, `.riskNextStep`, `.priorityItem` -- none of
 *     them set an explicit line-height) do NOT resolve to a pixel number via
 *     `getComputedStyle` (Chromium returns the literal string `'normal'`).
 *     For those, an ISOLATED, off-screen clone of the real element (with
 *     the real CSS-Module classNames -- rebuilt inside its real ancestor
 *     structure where a descendant selector needs one, e.g.
 *     Table.module.css's `.dense .td { padding: 10px 14px }`, which is
 *     scoped to a `.dense` ANCESTOR, not the `.td` itself -- copying just
 *     the `<td>`'s own className onto a bare, ancestor-less `<div>` was
 *     tried first and silently fell back to the wrong, non-dense `.td`
 *     rule, caught by comparing the calibration's reported padding/font
 *     against the known CSS values before trusting the result) had filler
 *     text appended one word at a time; the rendered height was sampled at
 *     every point it changed. The height DELTA between consecutive
 *     line-wraps is the true rendered line height (no assumption needed);
 *     the char count consumed per wrap is the true chars-per-line for that
 *     column width. Both this measurement technique and the CSS-value
 *     rewrite disqualification are why every "chars per line" constant
 *     below cites a real calibration transition list in its own comment,
 *     not an inferred/guessed number.
 *
 * EVERY charsPerLine constant is deliberately conservative: chosen so that
 * `estimateLines` never UNDER-counts the real number of wrapped lines
 * against the actual calibration samples that were collected (it may
 * occasionally OVER-count by one line). An over-estimate splits a slide one
 * row early -- cosmetic, and the documented safe direction; an under-
 * estimate is exactly the content-clipping bug this phase exists to fix.
 * `scripts/verify-deck-print.ts`'s per-slide print-media clipping assertion
 * (`scrollHeight <= clientHeight`) is what actually catches any future drift
 * in these constants -- if a fixture ever clips, these numbers are too
 * generous and must be tightened, never the assertion relaxed.
 *
 * Re-measure every constant below if ReportDeck.module.css's typography,
 * padding, or column widths ever change.
 */
export const DECK_METRICS = {
  // ---- Original Phase 8d (deck pagination) scope: structured (row/card-based) sections ----------

  /**
   * The vertical room available, on any `.padded` slide, for a section's
   * BODY -- i.e. everything below the kicker. `720 (slide height) - 2*88
   * (.padded's own top+bottom padding) - 48 (the kicker "block": a measured
   * 20px-tall kicker + its 28px margin-bottom)`. Confirmed by DIRECT
   * measurement (the span from the slide's content-top to the top of
   * whatever renders right after the kicker -- tableWrap/riskGrid/
   * priorityList all agreed to the pixel), not just this arithmetic.
   */
  bodyBudget: 496,
  /** Dense `<thead>` (Table.module.css's `.dense .th`) measured 40.5px; rounded UP -- extra per-chunk overhead is the safe direction. Charged once per tasks/tasksByClient CHUNK (each chunk renders its own `<table>`, so the header genuinely repeats "for free" -- see the chunkers below). */
  tableHeader: 42,
  /** Dense `.td` vertical padding (10px top + 10px bottom), exact -- confirmed via an isolated `<table class="...dense..."><td class="...">` calibration (see this constant group's own methodology comment for why the ancestor context mattered here). */
  taskRowPad: 20,
  /** Exact -- 8 consecutive wrap-calibration steps on the real 771px-wide task-title column (13px Open Sans) all measured exactly 18.0px apart. */
  taskLine: 18,
  /** 771px task-title column width @ 13px Open Sans. Observed calibration transitions (real char counts where the rendered row grew by exactly one `taskLine`): 11(1)->130(2)->260(3)->379(4)->509(5)->628(6)->758(7)->877(8) chars. `charsPerLine = 110` independently reproduces every one of those 8 real line counts via `estimateLines` -- never under, matching exactly at every sample. */
  taskCharsPerLine: 110,
  /**
   * A dense table ROW's real height is `max` across all four cells, not just
   * the task-title cell alone -- and the Status column's `<Badge>` (its own
   * padding + border, Badge.module.css) sets a floor no amount of short task
   * text can shrink below. Measured live on the real four-column table: a
   * single-word status ("Complete"/"Blocked") floors the row at 57px; the
   * two-word "In Progress" floors it at 63px (a taller badge). This constant
   * is the CONSERVATIVE (taller) floor across every status, applied
   * regardless of which status a given task actually has -- so
   * `taskItemHeight` never UNDER-estimates a short/lightly-wrapped task row
   * just because its own title text alone would estimate shorter than the
   * badge actually renders. This was the one real gap the harness caught on
   * its first run against this phase's fixtures (`overflow-tasks`/
   * `overflow-mixed` both clipped by 14-50px before this floor was added) --
   * an isolated `<td>` calibration (see this constant group's own
   * methodology comment) correctly measures the TEXT column in isolation,
   * but can't see a SIBLING cell's own height requirement, which only a
   * live multi-column table measurement exposes.
   */
  taskRowFloor: 63,
  /** `.riskCard` padding (22px top + 22px bottom = 44) + `.riskHeading`'s margin-bottom (10) + `.riskDescription`'s margin-bottom (8) + `.riskGrid`'s inter-card `gap` (20, charged to every card as its own "cost to the next card" since `packIntoSlides` has no separate gap parameter). 44+10+8+20 = 82. */
  riskCardPad: 82,
  /** `.riskDescription`'s line-height resolves numerically (`var(--leading-body)` @ 15.5px computes to 25.575px via `getComputedStyle`), rounded up. */
  riskLine: 26,
  /** 1034px risk-card content width. Calibration on `.riskDescription` (15.5px): real transitions 20(1)->80(1, still! long single-line text really does fit)->150(2)->220(2)->280(3)->340(3) chars -- `charsPerLine = 125` reproduces EVERY one of those exactly via `estimateLines`. Cross-checked against `.riskNextStep` (14px, wider effective capacity ~135-150 chars/line observed): 125 is still conservative there too (matches 4 of 6 real samples exactly, over-counts by exactly one line on the remaining 2 -- never under). One constant covers both fields per this module's "no separate cost per text field" contract. */
  riskCharsPerLine: 125,
  /** Measured 29px across every sampled risk card (client name + severity Badge, a single line in every real fixture); +1px safety pad. A client name long enough to wrap the heading itself to 2 lines is an accepted simplification -- not modeled (the `overflow: hidden` backstop still applies in that pathological case). */
  riskHeading: 30,
  /** Exact -- confirmed by BOTH a live risk-card sample (19/38/57px for 1/2/3 real lines) AND an independent isolated calibration (19px per line consumed, transitions at ~150-154 chars each). `.riskNextStep` has no padding/border of its own, so no separate "row pad" constant is needed for it (its cost is folded into `riskCardPad` above via `descMarginBottom`... no -- see `riskCardPad`'s own comment; next-step text itself contributes ONLY `estimateLines(...) * riskNextStepLine`, nothing fixed). */
  riskNextStepLine: 19,
  /**
   * `.priorityItem`'s CSS padding (18px top + 18px bottom = 36) + its
   * `border-bottom` (1px) = 37 was this constant's FIRST measurement -- via
   * an isolated, off-screen clone of a bare `<div class="...priorityItem...">`
   * with ONLY text content, no numeral sibling. That calibration reproduced
   * its own 8 samples exactly (63/89/115/141/167/193/219/245px, each a clean
   * multiple of 26 above 37) -- but it was measuring the WRONG thing: the
   * real `.priorityItem` is `display: flex; align-items: baseline` with TWO
   * children (the bold `.priorityNum` span AND the priority text), and
   * cross-axis `baseline` alignment between two flex items with slightly
   * different line-box metrics costs a few EXTRA pixels that an isolated,
   * single-child clone can never reproduce -- this was the second (and
   * final) real gap the harness caught (`overflow-mixed` clipped its first
   * priorities chunk by 14px even after `taskRowFloor` fixed the tasks
   * clipping), mirroring `taskRowFloor`'s own lesson: an isolated calibration
   * of an element in true production CONTEXT (with its real siblings) beats
   * an isolated clone every time content interacts with a
   * layout-affecting sibling. Re-measured LIVE against the real
   * `<ol class="priorityList"><li class="priorityItem">` markup (12 real
   * priority rows, numbered "P0." through "P11." exactly as production
   * numbers them): real heights 66/66/66/90/90/90/116/116/116/142/142/142px
   * for 1/2/3/4 real lines. Solving `pad + n*line` against the (mostly)
   * clean +26px-per-line deltas gives `pad = 40` (a `Math.max`-safe
   * over-estimate against the one slightly-irregular 66->90 transition,
   * which was +24 rather than +26 -- see `priorityLine`).
   */
  priorityRowPad: 40,
  /** See `priorityRowPad`'s comment: the dominant, repeated real delta between consecutive line counts (90->116, 116->142) was exactly 26px; the first transition (66->90) measured 24px, 2px tighter -- `priorityRowPad`'s slightly larger 40 (rather than a possible 42) absorbs that one irregular sample as a small, safe over-estimate instead of chasing sub-pixel noise with a third constant. */
  priorityLine: 26,
  /** 1032px priority-text column width (1088px slide content width minus the "N." numeral span + its 16px flex `gap` -- the numeral itself isn't charged a separate width constant; narrowing the calibration's own width by that amount folds the cost in conservatively). Observed calibration transitions: 4(1)->120(2)->233(3)->343(4)->459(5)->570(6)->682(7)->795(8) chars, average ~113 chars/line; `charsPerLine = 100` is a conservative reduction below every observed transition. */
  priorityCharsPerLine: 100,
  /** The daily-only "Tasks by Client" slide's per-client divider row (`.clientGroupCell`) -- measured 23px (a single-line client name in every real fixture); +1px safety pad. Used as a `keepWithNext` pack item's height (see `chunkTasksByClient`) so a group header is never widowed alone at the bottom of a slide. */
  clientGroupHeading: 24,
  /** `.slideFootnote` block: measured 18px text + its 24px `margin-top` = 42. Charged to EVERY tasks/tasksByClient chunk's effective budget unconditionally, not just the last chunk that actually renders it (`showFootnote` stays `true` on the last chunk only) -- simpler than a second packing pass, and still fully safe: the one chunk that DOES show the footnote is guaranteed to have reserved room for it; earlier chunks just carry a little unused slack. See `chunkTasks`'s own doc comment. */
  footnote: 42,

  // ---- Prose-chunking additions ------------------------------------------
  // The Phase 8d (deck pagination) planning doc's own DECK_METRICS sample had NO fields for
  // narrative/win-prose chunking at all -- that work was explicitly scoped
  // OUT of the plan, then explicitly added back in by the user after
  // reviewing the harness's own measured 711px of overflowing summary prose
  // (see this module's Phase 8d (deck pagination) header comment). These fields follow the exact
  // same live-measurement methodology as every field above; they're
  // grouped separately here purely so a future reviewer can see at a glance
  // which fields came from the original plan and which were added for that
  // follow-up decision.

  /** `.narrative` (23px, the weekly summary / daily glance slide's lead paragraph): line-height resolves numerically (`var(--leading-body)` @ 23px computes to 37.95px), rounded up. */
  narrativeLine: 38,
  /** 960px narrative max-width. Calibration transitions: 4(1)->95(2)->176(3)->272(4)->353(5)->449(6)->530(7)->626(8)->707(9)->803(10) chars, average ~89 chars/line; `charsPerLine = 80` reproduces every one of those 9 transitions exactly via `estimateLines`. */
  narrativeCharsPerLine: 80,
  /** `.narrative`'s own `margin: 0 0 40px`, exact -- CSS-explicit, no measurement needed beyond confirming it live (which it was). Charged on every narrative chunk (first AND continuation): `ReportDeck.tsx` renders a real `<p className={styles.narrative}>` for each chunk, so this margin genuinely applies every time, not just once. */
  narrativeMarginBottom: 40,
  /** The summary/glance slide's 3-card StatCard grid: measured grid height (113) + its own `margin-bottom` (28) = 141. Fixed regardless of report content -- it is always exactly 3 `StatCard`s with short numeric values, never a source of overflow itself. Reserved on a summary/glance section's FIRST chunk only (see `summaryFirstChunkBudget`) -- a continuation chunk shows narrative text only, per the plan's explicit instruction that "the stat cards + touchpoints caption belong on the FIRST chunk only." */
  statsBlock: 141,
  /** `.caption` (15px, the touchpoints narrative under the stat cards): line-height resolves numerically (`var(--leading-body)` @ 15px computes to 24.75px), rounded up. */
  captionLine: 25,
  /** 860px caption max-width. Calibration transitions: 7(1)->126(2)->257(3)->370(4)->494(5)->612(6)->736(7)->857(8) chars, average ~121 chars/line; `charsPerLine = 110` reproduces every one of those 7 transitions exactly via `estimateLines`. */
  captionCharsPerLine: 110,
  /** `.caption` is a plain `<p>` with NO CSS margin override -- this is the browser's own default paragraph margin (1em of the caption's own 15px font-size), confirmed LIVE (15px measured), not assumed from the UA stylesheet spec text. Reserved only when `touchpoints.narrative` is non-empty (an empty caption renders nothing at all, exactly as today). */
  captionMarginTop: 15,
  /** The Win slide's own available body height: `720 - 2*96 (.win's OWN, LARGER padding -- NOT .padded's 88px) - 48 (kicker block; `.win` renders the identical `.kicker` element every other section does, just recolored via the `.win .kicker` descendant rule)`. Confirmed live (528 total minus a measured 48px kicker block = 480). */
  winBodyBudget: 480,
  /** `.winStat` (140px display-serif digit; `line-height: 1` is CSS-explicit, so its rendered height is exactly its font-size) + its own 20px `margin-bottom` = 160, exact. */
  winStatBlock: 160,
  /** `.winLabel` measured 33px (22px font, a single line in every real fixture/seed -- win labels are short verb phrases) + its own 24px `margin-bottom` = 57. A win label long enough to wrap to 2+ lines would slightly under-reserve this fixed block; accepted simplification (the `overflow: hidden` backstop still applies in that pathological case, same tradeoff already accepted for `riskHeading`/`clientGroupHeading` above). Reserved on the Win section's FIRST chunk only, mirroring `statsBlock`. */
  winLabelBlock: 57,
  /** `.winNarrative` (18px): line-height resolves numerically (`var(--leading-body)` @ 18px computes to 29.7px), rounded up. Unlike `.narrative`/`.caption`, `.winNarrative` has `margin: 0` (CSS-explicit, confirmed live) -- it's always the slide's last element, so no trailing-margin budget subtraction is needed for it at all. */
  winNarrativeLine: 30,
  /** 820px win-narrative max-width. Calibration transitions: 3(1)->100(2)->198(3)->288(4)->379(5)->484(6)->576(7)->667(8)->761(9) chars, average ~95 chars/line; `charsPerLine = 85` reproduces every one of those 9 transitions exactly via `estimateLines`. */
  winNarrativeCharsPerLine: 85,
} as const;

/**
 * A pure, framework-free estimate of how many wrapped lines `text` will
 * occupy at `charsPerLine` -- NOT a real word-wrap simulation (no width
 * measurement, no font metrics, no word-boundary math; see `DECK_METRICS`'s
 * own doc comment for why that's the deliberate design, option (b) rather
 * than (c)). `charsPerLine` is always one of `DECK_METRICS`'s conservative,
 * live-measured constants, so this under-counts real capacity rather than
 * over-counting it -- the safe direction against clipping.
 */
export function estimateLines(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * One row/card/priority/group-header queued for `packIntoSlides` below.
 * `height` is this item's own estimated contribution to a slide's body
 * height (already including whatever trailing gap/margin it costs the NEXT
 * item -- `packIntoSlides` has no separate "gap" parameter, so every
 * per-item height constant above folds its own spacing in). `keepWithNext`
 * marks a WIDOW-PRONE item -- today, only a client-group divider row
 * (`chunkTasksByClient`) -- that must never be the last thing on a slide
 * with none of its own content following it.
 */
export interface PackItem {
  height: number;
  keepWithNext?: boolean;
}

/**
 * Greedily packs `items` into the fewest possible slides such that each
 * slide's accumulated height (`perSlideOverhead` -- e.g. a repeating table
 * header -- plus every item's own `height`) never exceeds `budget`.
 *
 * Rules (Phase 8d (deck pagination) plan, verbatim):
 *   - items are ATOMIC -- never split (a task row, risk card, or priority
 *     line is always whole on whichever slide it lands on).
 *   - a `keepWithNext` item (a client-group header) is pushed to the NEXT
 *     slide if the item immediately following it wouldn't also fit
 *     alongside it on the current slide -- this is WIDOW CONTROL: a header
 *     is never the last thing on a slide with none of its own content below
 *     it. (If there IS no following item -- an empty client group, which
 *     `groupTasksByClient` never actually produces -- the header is treated
 *     like any other item.)
 *   - every slide accepts AT LEAST ONE item even if that item alone exceeds
 *     `budget` -- a TERMINATION GUARANTEE (this function must always make
 *     forward progress through `items`); the oversized case is exactly what
 *     `.slide { overflow: hidden }` backstops, not something this packer
 *     needs to solve.
 *   - `perSlideOverhead` is charged once per slide (not once per item) --
 *     e.g. `DECK_METRICS.tableHeader`, since each tasks/tasksByClient CHUNK
 *     renders its own `<table>` with its own `<thead>`, so the header
 *     genuinely repeats "for free" per printed page.
 *
 * Returns `[]` for an empty `items` array (never `[[]]`) -- callers that
 * must still show exactly one (empty-state) slide handle that explicitly,
 * matching how each section already rendered an empty-state message before
 * Phase 8d (deck pagination).
 */
export function packIntoSlides<T extends PackItem>(items: T[], budget: number, perSlideOverhead: number): T[][] {
  if (items.length === 0) return [];

  const slides: T[][] = [];
  let current: T[] = [];
  let currentHeight = perSlideOverhead;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.keepWithNext) {
      const next: T | undefined = items[i + 1];
      const combinedHeight = item.height + (next ? next.height : 0);
      if (current.length > 0 && currentHeight + combinedHeight > budget) {
        slides.push(current);
        current = [];
        currentHeight = perSlideOverhead;
      }
      current.push(item);
      currentHeight += item.height;
      continue;
    }

    if (current.length > 0 && currentHeight + item.height > budget) {
      slides.push(current);
      current = [];
      currentHeight = perSlideOverhead;
    }
    current.push(item);
    currentHeight += item.height;
  }

  if (current.length > 0) slides.push(current);
  return slides;
}

function taskItemHeight(task: Task): number {
  const textHeight = DECK_METRICS.taskRowPad + estimateLines(task.task, DECK_METRICS.taskCharsPerLine) * DECK_METRICS.taskLine;
  // See `DECK_METRICS.taskRowFloor`'s own doc comment: a real row is never
  // shorter than the Status badge's own rendered height, no matter how
  // little text the task title itself would estimate.
  return Math.max(DECK_METRICS.taskRowFloor, textHeight);
}

function riskItemHeight(risk: Risk): number {
  return (
    DECK_METRICS.riskCardPad +
    DECK_METRICS.riskHeading +
    estimateLines(risk.description, DECK_METRICS.riskCharsPerLine) * DECK_METRICS.riskLine +
    estimateLines(risk.nextStep, DECK_METRICS.riskCharsPerLine) * DECK_METRICS.riskNextStepLine
  );
}

function priorityItemHeight(priority: Priority): number {
  return DECK_METRICS.priorityRowPad + estimateLines(priority.text, DECK_METRICS.priorityCharsPerLine) * DECK_METRICS.priorityLine;
}

interface TaskPackItem extends PackItem {
  task: Task;
}

/**
 * Chunks a flat task list (the weekly `tasks` slide) into as many slides as
 * the content actually needs. `showFootnote` is `true` only on the LAST
 * chunk -- the whole-report on-schedule/blocker footnote must appear
 * exactly once, at the end, never repeated per chunk (ReportDeck.tsx already
 * reads it from `report.tasks` directly, not from `body.rows`, for this
 * exact reason -- see that file's `renderSlideBody` doc comment).
 *
 * `DECK_METRICS.footnote` is folded into `perSlideOverhead` UNCONDITIONALLY
 * (every chunk's effective budget is reduced by it, not just the chunk that
 * actually renders it) -- simpler than a second "does the footnote still
 * fit on the chunk we already built" pass, and still fully safe: whichever
 * chunk ends up last (and therefore shows the footnote) is guaranteed to
 * have reserved the room for it; earlier chunks just carry a little unused
 * slack they never needed anyway.
 */
export function chunkTasks(tasks: Task[]): { rows: Task[]; showFootnote: boolean }[] {
  const items: TaskPackItem[] = tasks.map((task) => ({ task, height: taskItemHeight(task) }));
  const chunks = packIntoSlides(items, DECK_METRICS.bodyBudget, DECK_METRICS.tableHeader + DECK_METRICS.footnote);
  if (chunks.length === 0) return [{ rows: [], showFootnote: true }];
  return chunks.map((chunk, i) => ({ rows: chunk.map((it) => it.task), showFootnote: i === chunks.length - 1 }));
}

interface ClientHeaderPackItem extends PackItem {
  kind: 'header';
}
interface ClientTaskPackItem extends PackItem {
  kind: 'task';
  task: Task;
}
type ClientGroupedPackItem = ClientHeaderPackItem | ClientTaskPackItem;

/**
 * Chunks a daily report's tasks (grouped by client, the "Tasks by Client"
 * slide) into as many slides as the content needs. Each client group
 * contributes a synthetic, `keepWithNext` HEADER item (costing
 * `clientGroupHeading`) immediately followed by its own task items -- the
 * header item exists PURELY to (a) budget the divider row's height and (b)
 * trigger `packIntoSlides`'s widow-avoidance rule; it is never rendered
 * directly.
 *
 * Groups are RE-DERIVED from scratch per resulting chunk (via
 * `groupTasksByClient`, the exact same helper the un-chunked daily deck
 * already used) by filtering each chunk down to its `'task'` items and
 * re-grouping them -- this is what makes a mid-group continuation "just
 * work" with zero special-casing: if a single client's own task list is
 * long enough to spill across a slide boundary, the continuation slide's
 * re-derived group naturally shows that client's name again as its own
 * fresh divider row. A client label is never silently lost, and no separate
 * "(cont'd)" bookkeeping is needed -- `ReportDeck.tsx` already renders one
 * divider row per entry in `body.groups`, regardless of whether THIS
 * chunk's data happened to include the section's very first header item
 * for that client or not.
 */
export function chunkTasksByClient(tasks: Task[]): { groups: ClientTaskGroup[]; showFootnote: boolean }[] {
  const groups = groupTasksByClient(tasks);
  const items: ClientGroupedPackItem[] = [];
  for (const group of groups) {
    items.push({ kind: 'header', height: DECK_METRICS.clientGroupHeading, keepWithNext: true });
    for (const task of group.tasks) {
      items.push({ kind: 'task', task, height: taskItemHeight(task) });
    }
  }

  const chunks = packIntoSlides(items, DECK_METRICS.bodyBudget, DECK_METRICS.tableHeader + DECK_METRICS.footnote);
  if (chunks.length === 0) return [{ groups: [], showFootnote: true }];
  return chunks.map((chunk, i) => {
    const chunkTasks = chunk.filter((it): it is ClientTaskPackItem => it.kind === 'task').map((it) => it.task);
    return { groups: groupTasksByClient(chunkTasks), showFootnote: i === chunks.length - 1 };
  });
}

interface RiskPackItem extends PackItem {
  risk: Risk;
}

/** Chunks the Risks & Blockers section. No `perSlideOverhead` -- unlike a table, a risk card carries no repeating chrome of its own; every card's own cost is already fully captured by `riskItemHeight`. */
export function chunkRisks(risks: Risk[]): Risk[][] {
  const items: RiskPackItem[] = risks.map((risk) => ({ risk, height: riskItemHeight(risk) }));
  const chunks = packIntoSlides(items, DECK_METRICS.bodyBudget, 0);
  return chunks.length > 0 ? chunks.map((chunk) => chunk.map((it) => it.risk)) : [[]];
}

interface PriorityPackItem extends PackItem {
  priority: Priority;
}

/**
 * Chunks the Priorities section. `startIndex` carries the running 1-based
 * count ACROSS chunks (Phase 8d (deck slide model) replaced the old CSS `counter(priority)` with an
 * explicit JSX number specifically so this could continue correctly instead
 * of silently restarting at "1." on every continuation slide -- see
 * ReportDeck.module.css's `.priorityNum` comment).
 */
export function chunkPriorities(priorities: Priority[]): { rows: Priority[]; startIndex: number }[] {
  const items: PriorityPackItem[] = priorities.map((priority) => ({ priority, height: priorityItemHeight(priority) }));
  const chunks = packIntoSlides(items, DECK_METRICS.bodyBudget, 0);
  if (chunks.length === 0) return [{ rows: [], startIndex: 1 }];
  let startIndex = 1;
  return chunks.map((chunk) => {
    const rows = chunk.map((it) => it.priority);
    const result = { rows, startIndex };
    startIndex += rows.length;
    return result;
  });
}

/** Paragraph boundary: two or more consecutive newlines. */
const PARAGRAPH_SPLIT = /\n{2,}/;
/** Sentence boundary: whitespace immediately after a `.`/`!`/`?`, immediately before the next sentence's first non-space character. A lookbehind (not a capturing split-and-rejoin) so the terminal punctuation stays attached to the sentence that owns it. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=\S)/;

function splitSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  return trimmed ? trimmed.split(SENTENCE_SPLIT) : [];
}

function textBlockHeight(text: string, charsPerLine: number, lineHeight: number): number {
  return estimateLines(text, charsPerLine) * lineHeight;
}

/**
 * Splits `text` into the fewest chunks that each fit their slide's narrative
 * budget, WITHOUT EVER splitting mid-sentence -- the user-approved addition
 * beyond the Phase 8d (deck pagination) plan's original (structured-sections-only) scope; see this
 * module's Phase 8d (deck pagination) header comment. Powers the weekly `summary` / daily `glance`
 * slide's `summaryNarrative` and the `win` slide's `win.narrative`.
 *
 * Paragraphs (`\n\n`-separated) are the primary packing unit -- co-resident
 * paragraphs that both fit in the same chunk are rejoined with `\n\n` so a
 * short multi-paragraph narrative still renders as one natural block,
 * exactly as it always has. Only a single paragraph that ALONE overflows an
 * entire EMPTY chunk's budget falls back to SENTENCE-level packing -- and
 * even then, a single sentence that alone still overflows a whole chunk
 * gets its own chunk anyway: the documented pathological case
 * `.slide { overflow: hidden }` exists to backstop, not a crash, and not
 * something this function needs to solve by breaking its own "never split
 * mid-sentence" contract.
 *
 * `firstBudget` is smaller than `restBudget` for the two sections that carry
 * a fixed block (StatCard trio + caption, or the win stat + label) on their
 * first chunk only -- see `summaryFirstChunkBudget`/`winFirstChunkBudget`
 * below, which compute it.
 */
export function chunkNarrative(text: string, firstBudget: number, restBudget: number, charsPerLine: number, lineHeight: number): string[] {
  const paragraphs = text
    .split(PARAGRAPH_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [''];

  const chunks: string[] = [];
  let budget = firstBudget;
  let parts: string[] = [];
  let used = 0;

  // Closes out whatever's currently accumulated as its own chunk (a no-op if
  // nothing has been accumulated yet) and advances `budget` to `restBudget`
  // -- but ONLY when a real chunk was actually closed. Advancing `budget`
  // unconditionally here was an earlier bug caught before this shipped: it
  // prematurely switched chunk 1's budget to the (usually larger, since
  // chunk 1 reserves room for a fixed stats/win block) `restBudget` the
  // moment the FIRST paragraph was assigned, before a second paragraph ever
  // got a chance to test whether it still fit alongside the first one in
  // chunk 1's own (smaller) budget -- silently forcing an unnecessary early
  // split on the very first pair of paragraphs of nearly every multi-
  // paragraph narrative.
  const closeChunk = () => {
    if (parts.length > 0) {
      chunks.push(parts.join('\n\n'));
      budget = restBudget;
    }
    parts = [];
    used = 0;
  };

  for (const paragraph of paragraphs) {
    const height = textBlockHeight(paragraph, charsPerLine, lineHeight);

    if (parts.length > 0 && used + height <= budget) {
      parts.push(paragraph);
      used += height;
      continue;
    }

    // Doesn't fit alongside whatever's already accumulated (or nothing is
    // accumulated yet) -- close out the current chunk (a no-op if empty) so
    // `budget` correctly reflects the chunk this paragraph is ABOUT TO
    // START before deciding where it goes.
    closeChunk();

    if (height <= budget) {
      parts.push(paragraph);
      used = height;
      continue;
    }

    // This paragraph alone overflows an entire empty chunk -- sentence-level
    // fallback. Never splits a sentence itself.
    let sentenceParts: string[] = [];
    let sentenceUsed = 0;
    for (const sentence of splitSentences(paragraph)) {
      const sentenceHeight = textBlockHeight(sentence, charsPerLine, lineHeight);
      if (sentenceParts.length > 0 && sentenceUsed + sentenceHeight > budget) {
        chunks.push(sentenceParts.join(' '));
        sentenceParts = [];
        sentenceUsed = 0;
        budget = restBudget;
      }
      // A lone sentence that itself exceeds a whole (empty) chunk still gets
      // added here regardless -- the same termination guarantee
      // `packIntoSlides` applies to structured items, just for prose: this
      // function must always make forward progress through the paragraph's
      // sentences, and the resulting oversized single-sentence chunk is
      // exactly what `.slide { overflow: hidden }` backstops.
      sentenceParts.push(sentence);
      sentenceUsed += sentenceHeight;
    }
    if (sentenceParts.length > 0) chunks.push(sentenceParts.join(' '));
    budget = restBudget;
  }
  closeChunk();

  return chunks.length > 0 ? chunks : [''];
}

/**
 * The weekly summary / daily glance slide's FIRST-chunk narrative budget --
 * smaller than every later chunk's, because chunk 1 alone also carries the
 * StatCard trio (`DECK_METRICS.statsBlock`, fixed) and, when present, the
 * touchpoints caption (`DECK_METRICS.captionMarginTop` + its own estimated
 * line count) -- see `DeckSlideBody`'s `summary`/`glance` doc comment for why
 * those belong on chunk 1 only.
 */
function summaryFirstChunkBudget(report: AnyReport): number {
  const captionText = report.touchpoints.narrative;
  const captionBlock = captionText
    ? DECK_METRICS.captionMarginTop + estimateLines(captionText, DECK_METRICS.captionCharsPerLine) * DECK_METRICS.captionLine
    : 0;
  return DECK_METRICS.bodyBudget - DECK_METRICS.narrativeMarginBottom - DECK_METRICS.statsBlock - captionBlock;
}

/** The weekly summary / daily glance slide's CONTINUATION-chunk narrative budget -- the full `bodyBudget`, minus only the narrative `<p>`'s own trailing margin (which every chunk's `<p>` carries, first or not). */
function summaryRestChunkBudget(): number {
  return DECK_METRICS.bodyBudget - DECK_METRICS.narrativeMarginBottom;
}

/** The Win slide's FIRST-chunk narrative budget -- smaller than every later chunk's, because chunk 1 alone also carries the win stat + label (`DECK_METRICS.winStatBlock` + `winLabelBlock`, fixed). */
function winFirstChunkBudget(): number {
  return DECK_METRICS.winBodyBudget - DECK_METRICS.winStatBlock - DECK_METRICS.winLabelBlock;
}

/** `${section}-${1-based index}` once a section spans more than one slide; the section's plain, un-suffixed key when it doesn't (`total === 1`) -- see `DeckSlide.key`'s own doc comment for why that byte-identical single-slide case matters. */
function slideKey(base: string, index: number, total: number): string {
  return total > 1 ? `${base}-${index + 1}` : base;
}

/** `null` for a single-slide section (identical to every pre-Phase 8d (deck pagination) slide); `{index, total}` (both 1-based) once a section spans more than one. */
function slidePart(index: number, total: number): SlidePart | null {
  return total > 1 ? { index: index + 1, total } : null;
}

function buildSummarySlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkNarrative(
    report.summaryNarrative,
    summaryFirstChunkBudget(report),
    summaryRestChunkBudget(),
    DECK_METRICS.narrativeCharsPerLine,
    DECK_METRICS.narrativeLine
  );
  const bodyType = report.kind === 'daily' ? 'glance' : 'summary';
  const total = chunks.length;
  return chunks.map((narrative, i) => ({
    key: slideKey('summary', i, total),
    title,
    part: slidePart(i, total),
    body: { type: bodyType, narrative, showStats: i === 0 } as DeckSlideBody,
  }));
}

function buildTasksSlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkTasks(report.tasks);
  const total = chunks.length;
  return chunks.map((chunk, i) => ({
    key: slideKey('tasks', i, total),
    title,
    part: slidePart(i, total),
    body: { type: 'tasks', rows: chunk.rows, showFootnote: chunk.showFootnote },
  }));
}

function buildTasksByClientSlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkTasksByClient(report.tasks);
  const total = chunks.length;
  return chunks.map((chunk, i) => ({
    key: slideKey('tasks', i, total),
    title,
    part: slidePart(i, total),
    body: { type: 'tasksByClient', groups: chunk.groups, showFootnote: chunk.showFootnote },
  }));
}

function buildRiskSlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkRisks(report.risks);
  const total = chunks.length;
  return chunks.map((rows, i) => ({
    key: slideKey('risks', i, total),
    title,
    part: slidePart(i, total),
    body: { type: 'risks', rows },
  }));
}

function buildPrioritySlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkPriorities(report.priorities);
  const total = chunks.length;
  return chunks.map((chunk, i) => ({
    key: slideKey('priorities', i, total),
    title,
    part: slidePart(i, total),
    body: { type: 'priorities', rows: chunk.rows, startIndex: chunk.startIndex },
  }));
}

function buildWinSlides(report: AnyReport, title: string): DeckSlide[] {
  const chunks = chunkNarrative(
    report.win.narrative,
    winFirstChunkBudget(),
    DECK_METRICS.winBodyBudget,
    DECK_METRICS.winNarrativeCharsPerLine,
    DECK_METRICS.winNarrativeLine
  );
  const total = chunks.length;
  return chunks.map((narrative, i) => ({
    key: slideKey('win', i, total),
    title,
    part: slidePart(i, total),
    body: { type: 'win', narrative, showStat: i === 0 },
  }));
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
 * Keep it boring and deterministic. Phase 8d's chunkers/`chunkNarrative` are
 * themselves pure functions of their own arguments (report fields + the
 * constant `DECK_METRICS`), so this guarantee is unchanged by pagination.
 *
 * A WEEKLY report keeps Phase 8d (deck slide model)'s fixed slide ORDER, unconditionally: Cover,
 * Summary, Task Status, Risks & Blockers, Priorities, The Win -- Phase 8d (deck pagination) changes
 * only whether any one of those sections now spans MORE than one physical
 * slide, never the section order itself. A report that never overflows any
 * section still produces exactly the same six slides, in the same order,
 * with the same keys, as before this phase (see `scripts/verify-deck-
 * print.ts`'s `baseline-weekly` fixture, which is the regression check for
 * exactly this).
 *
 * A DAILY report (Phase 8d (per-kind sections)) gets a slide list that matches what a single day
 * spanning every client actually is: Cover, an at-a-glance summary
 * ("glance"), tasks broken out BY CLIENT ("tasksByClient" -- see
 * `groupTasksByClient`, lib/report-sections.ts) instead of one flat list,
 * Risks & Blockers (retitled "Blockers Needing Attention" per
 * `SECTION_HEADINGS`), Priorities (retitled "Tomorrow & Follow-Ups"), and a
 * Win slide that's OMITTED ENTIRELY when `hasWin(report)` is false -- unlike
 * a weekly, which always gets a Win slide even when its stat/label/
 * narrative are blank (the deck's existing `'—'` stat fallback handles
 * that case, and a weekly report having "no win this week" is itself
 * meaningful status to surface).
 *
 * `PresentScreen`'s navigator (dot count, `1-9` digit-jump range, "n / N"
 * counter) and the print-page-count contract (styles/print.css) both derive
 * everything from `slides.length` -- Phase 8d (deck pagination) needed zero changes to either for
 * a report's TOTAL slide count to grow past six; see
 * scripts/verify-deck-print.ts's `overflow-tasks`/`overflow-mixed`/
 * `daily-many-clients` fixtures, which assert exactly that end-to-end.
 */
export function buildDeckSlides(report: AnyReport): DeckSlide[] {
  const headings = SECTION_HEADINGS[report.kind];

  if (report.kind === 'daily') {
    const slides: DeckSlide[] = [
      { key: 'cover', title: 'Cover', part: null, body: { type: 'cover' } },
      ...buildSummarySlides(report, headings.summary),
      ...buildTasksByClientSlides(report, headings.tasks),
      ...buildRiskSlides(report, headings.risks),
      ...buildPrioritySlides(report, headings.priorities),
    ];
    // The one genuinely content-dependent slide-count branch that predates
    // Phase 8d (deck pagination): a daily report with no recorded win gets no Win slide at all,
    // rather than a slide showing an empty '—' stat (which would read as
    // "there IS a win, but it's blank" instead of "no win today").
    if (hasWin(report)) {
      slides.push(...buildWinSlides(report, headings.win));
    }
    return slides;
  }

  return [
    { key: 'cover', title: 'Cover', part: null, body: { type: 'cover' } },
    ...buildSummarySlides(report, headings.summary),
    ...buildTasksSlides(report, headings.tasks),
    ...buildRiskSlides(report, headings.risks),
    ...buildPrioritySlides(report, headings.priorities),
    ...buildWinSlides(report, headings.win),
  ];
}
