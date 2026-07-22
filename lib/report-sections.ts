// WP2 of the "dynamic deck" plan (WP1 = lib/deck-slides.ts making the slide
// list data). WP1 deliberately kept every report kind rendering the exact
// same six sections -- this module is the thing that finally lets a WEEKLY
// and a DAILY report look like what they actually are: a weekly is a week
// with a roll-up, a win, and next-week priorities (a narrative arc); a daily
// is a single day spanning EVERY client (its defining nature is breadth
// across clients, not a weekly story). Both `lib/deck-slides.ts` (the deck)
// and `components/report/ReportScreen.tsx` (the working-document screen)
// import from here -- this is the ONE place their per-kind "methodology"
// (section wording, and the daily-only client-grouping derivation) is
// decided, so screen and deck can never independently drift on what a
// section is called or how a daily report's tasks get organized.
//
// Deliberately pure (no React, no 'use client') -- same discipline as
// lib/view-utils.ts and lib/deck-slides.ts: this is display-only regrouping
// over data that's already loaded, not a new domain shape, so it needs no
// migration (see CLAUDE.md "Migrations discipline") and no hook.

import type { AnyReport, ReportKind, Task } from './types';

/**
 * One client's slice of a report's tasks, in first-appearance order. This
 * powers the daily deck's "Tasks by Client" slide and the daily report
 * screen's per-client task tables -- the daily report's defining shape is
 * "every client, one day," so grouping by client (rather than dumping every
 * client's tasks into one flat table, which is what the weekly view still
 * does) is the whole point of a daily's "methodology."
 */
export interface ClientTaskGroup {
  client: string;
  tasks: Task[];
}

/**
 * Groups `tasks` by their exact `client` string -- NEVER by `projectId`.
 * This is a display grouping, not an identity join: `client` is the same
 * free-text field `(client, task)` dedupe (useWizard's Import panels,
 * lib/aggregate.ts) and CSV import already treat as the authoritative
 * display string, and two tasks can share a `projectId` while carrying
 * slightly different historical `client` spellings (see CLAUDE.md's Phase
 * 8c rename-safety note: `client` text is never rewritten on a project
 * rename). Grouping by `projectId` here would silently merge or split
 * groups in a way that disagrees with what the task's own `client` field
 * says on screen.
 *
 * Group order is first-appearance order in `tasks` (NOT alphabetical) --
 * matches the "author order" convention `groupTasksByStatus`
 * (lib/view-utils.ts) and the dedupe-key philosophy elsewhere in this repo:
 * the order a PM entered clients in is treated as meaningful, not an
 * accident to be sorted away.
 */
export function groupTasksByClient(tasks: Task[]): ClientTaskGroup[] {
  const order: string[] = [];
  const byClient = new Map<string, Task[]>();
  for (const task of tasks) {
    let bucket = byClient.get(task.client);
    if (!bucket) {
      bucket = [];
      byClient.set(task.client, bucket);
      order.push(task.client);
    }
    bucket.push(task);
  }
  return order.map((client) => ({ client, tasks: byClient.get(client) ?? [] }));
}

/**
 * True when `report`'s Win section actually has content worth showing.
 * Trims every field first -- a `win` object whose fields are all
 * whitespace is, for display purposes, exactly as empty as `''`
 * (`blankDraft`/`blankDailyDraft`, lib/report-utils.ts, seed every new
 * report's `win` this way).
 *
 * Powers `buildDeckSlides`'s decision to omit a daily report's Win slide
 * entirely when nothing was recorded (a weekly ALWAYS gets a Win slide --
 * see that function's own doc comment for why the two kinds differ here)
 * and `ReportScreen`'s matching decision to hide its Win section for a
 * daily report with no win, so the screen and the deck can never disagree
 * about whether "there's a win to show."
 */
export function hasWin(report: AnyReport): boolean {
  return Boolean(report.win.stat.trim() || report.win.label.trim() || report.win.narrative.trim());
}

/** The four/five section kickers `SECTION_HEADINGS` decides per report kind (see that constant's own doc comment). */
export interface SectionHeadings {
  summary: string;
  tasks: string;
  risks: string;
  priorities: string;
  win: string;
}

/**
 * The SINGLE place a weekly and a daily report's section wording is
 * decided -- both `buildDeckSlides` (lib/deck-slides.ts, which feeds these
 * strings into each `DeckSlide.title`, which `ReportDeck.tsx` then renders
 * verbatim as its `.kicker` text -- see that file for why it reads
 * `slide.title` instead of re-deciding wording itself) and `ReportScreen`
 * import this constant directly for their own section kickers. Before this
 * module existed, "Today" vs. "This Week" (summary) and "Priorities" vs.
 * "Next Week's Priorities" lived as ad-hoc `report.kind === 'daily' ? ... :
 * ...` ternaries duplicated across ReportDeck.tsx and ReportScreen.tsx --
 * exactly the kind of drift risk this file exists to close off.
 *
 * Weekly headings describe a week with a narrative arc: what happened this
 * week, its task status, its risks, next week's priorities, the win.
 * Daily headings describe a single day spanning every client: an
 * at-a-glance summary, tasks broken out BY CLIENT (not one flat list --
 * see `groupTasksByClient`'s own doc comment for why), blockers that need
 * attention today, and a short look ahead ("Tomorrow & Follow-Ups" is
 * deliberately narrower in scope than a weekly's "next week," since a daily
 * report's planning horizon is the very next business day, not a full
 * week). "The Win" is identical wording for both kinds -- a good outcome is
 * a good outcome regardless of period length, so there's no daily-specific
 * spin to put on it.
 */
export const SECTION_HEADINGS: Record<ReportKind, SectionHeadings> = {
  weekly: {
    summary: 'This Week',
    tasks: 'Task Status',
    risks: 'Risks & Blockers',
    priorities: "Next Week's Priorities",
    win: 'The Win',
  },
  daily: {
    summary: 'Day at a Glance',
    tasks: 'Tasks by Client',
    risks: 'Blockers Needing Attention',
    priorities: 'Tomorrow & Follow-Ups',
    win: 'The Win',
  },
};
