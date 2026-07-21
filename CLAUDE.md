# Weekly Reports Dashboard — Foundation First Marketing

Internal weekly-reporting web app for a boutique marketing agency. Project managers
compose a structured weekly report (tasks, risks, touchpoints, a win, next-week
priorities) through a 6-step wizard, then browse/filter published reports on a
dashboard. Ported from a Claude Design prototype (`design-source/original-dashboard.dc.html`).

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript** (strict).
- **Real App Router routing** — a sidebar app shell + route-per-screen (see
  "Routing" below). No client-side view-switcher.
- **No Tailwind.** Styling = brand CSS custom properties (`styles/tokens/*.css`
  + `styles/theme.css` / `styles/theme-dark.css`) + CSS Modules for UI
  primitives. Components read semantic tokens (`var(--text-heading)`,
  `var(--surface-card)`, ...); no `darkMode ? {...} : {...}` inline-style
  branching anywhere (see "Dark mode" below).
- **Radix primitives** (`radix-ui` unified package) power `Dialog`, `Select`,
  `Switch`, and the sidebar's collapsed-nav `Tooltip` — headless, 100% styled
  by our own CSS Modules (see "Radix primitives" below).
- Fonts via `next/font/google`: **Poppins** (headings/UI) + **Open Sans** (body).
- Persistence: **swappable `ReportsRepository`**. MVP = `localStorage` impl
  (`lib/data/`). Future = Supabase/Postgres impl behind the same interface — the
  UI must never import a concrete repository, only `getReportsRepository()`.
  A baseline schema is already versioned at `supabase/migrations/` (see
  "Migrations discipline" below) even though no repository reads it yet.

## Roadmap

- **Now (Phase 7 complete):** Full stack with optional Supabase backend. **Demo mode** (no
  `NEXT_PUBLIC_SUPABASE_URL` env) runs on `localStorage` (`ff.reports.v2`, projects in
  `ff.projects.v1`), seeded with 7 weekly + 5 daily reports. **Supabase mode** (env set)
  uses Postgres + HTTP repository with Auth (magic-link sign-in), per-user ownership, RLS,
  and **cross-machine share links** via per-report public tokens. Share links resolve to an
  interactive branded HTML slide-deck route (`/reports/[id]/present` or `/daily/[id]/present`,
  outside the shell) with keyboard nav, touch swipe, deep links, fullscreen, and token-based
  anon access; "PDF export" is real browser print-to-PDF (exact 6 pages in Chromium, letterboxed
  in Firefox/Safari). Task (List/Kanban) and Calendar (Week/Month) views (Phase 3) derive from
  `Report[]` (weeklies only; dailies in these views are a documented Phase 4 follow-up). Phase 4
  added daily reports (`/daily/*`) and the weekly wizard's "Import This Week's Daily Reports"
  roll-up. Phase 5 added Settings (`/settings`) with theme picker (Light/Dark/System),
  prompt library, CSV import templates; report screen is now the working document. Phase 6
  refactored the type system to Zod (6a), added the Project entity (6a), built CSV import
  (6b), and added report consolidation (6b). Phase 7a added the Supabase schema + Auth layer.
  Phase 7b connected the UI → Postgres (M1 server plane, M2 cutover, M3 cross-machine sharing,
  M4 local import) with two rounds of adversarial hardening.
- **Later (Phase 8):** remote MCP server + Claude Skill (locked tool names already documented in
  `lib/prompts.ts`; Phase 8's `update_report` will use `expectedUpdatedAt` CAS for optimistic
  concurrency).
- **Deployment (Phase 9):** Vercel deploy, production-hardening checklist (access-log token scrubbing, etc.).
- Post-MVP backlog lives in `design-source/NEXT_STEPS.md` — **out of scope now.**

## Routing

Real App Router routes. Every route lives inside the `(shell)` route group
(a sidebar + content grid) **except** `/reports/[id]/present` and
`/daily/[id]/present`, which deliberately sit outside it so only the root
layout applies (no sidebar on the bare, shareable slide-deck routes):

```
app/
  layout.tsx                          # html/body, fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                        # 'use client' -- <AppShell> (sidebar + main)
    page.tsx                          # /                       Dashboard (weeklies only)
    reports/new/page.tsx              # /reports/new             Weekly wizard (blank)
    reports/[id]/edit/page.tsx        # /reports/:id/edit        Weekly wizard (resume draft)
    reports/[id]/page.tsx             # /reports/:id             Report screen (Phase 2)
    daily/page.tsx                   # /daily                    Daily report list (Phase 4)
    daily/new/page.tsx               # /daily/new                Daily wizard (blank, Phase 4)
    daily/[id]/edit/page.tsx         # /daily/:id/edit           Daily wizard (resume draft, Phase 4)
    daily/[id]/page.tsx              # /daily/:id                Daily report screen (Phase 4)
    tasks/page.tsx                    # /tasks                   Task view: List/Kanban (Phase 3)
    calendar/page.tsx                 # /calendar                Calendar view: Week/Month (Phase 3)
    consolidate/page.tsx              # /consolidate             Consolidate weeklies/dailies (Phase 6b)
    settings/page.tsx                 # /settings                Settings (theme, prompts, CSV templates, Phase 5; CSV import, Phase 6b)
  reports/[id]/present/page.tsx       # /reports/:id/present     Interactive slide-deck route (Phase 2; made interactive Phase 5, outside (shell))
  daily/[id]/present/page.tsx        # /daily/:id/present        Interactive slide-deck route (Phase 4; made interactive Phase 5, outside (shell))
```

`app/(shell)/reports/[id]/page.tsx` and `app/reports/[id]/present/page.tsx`
(and, identically, `app/(shell)/daily/[id]/page.tsx` and
`app/daily/[id]/present/page.tsx`) each pair contributes to the same
`.../[id]/*` URL space from two different physical trees (one inside the
`(shell)` group, one outside it) but resolves to distinct paths -- verified
in `next build`'s route table (no route-group collision error) and by
inspecting the rendered DOM (only the `present` route is sidebar-free). If a
future route ever needs a genuinely different `[id]` param name at the same
segment depth, promote `present/` into its own `(present)` route group
instead of relying on this.

`/tasks` (List/Kanban) and `/calendar` (Week/Month) landed in Phase 3 (see
"Task and Calendar views (Phase 3)" below). `/daily/*` landed in Phase 4
(see "Daily reports & the weekly import (Phase 4)" below).

Route-level orchestration (filter/sort/pagination state, dialog hosting,
`useReports()`/`useDailyReports()` calls) lives in
`components/dashboard/DashboardPage.tsx`, `components/daily/DailyPage.tsx`,
and `components/wizard/WizardPage.tsx`; `app/(shell)/**/page.tsx` files are
thin wrappers around those. `DashboardScreen`/`DailyListScreen`/
`WizardScreen` stay presentational (prop-driven), matching the pre-Phase-1
convention. `app/(shell)/reports/[id]/page.tsx`, `app/(shell)/daily/
[id]/page.tsx`, `app/(shell)/tasks/page.tsx`, `app/(shell)/calendar/
page.tsx`, `app/(shell)/consolidate/page.tsx`, and `app/(shell)/settings/page.tsx`
break from that split on purpose (see "Report screen & presentation deck",
"Task and Calendar views", "Consolidation (Phase 6b)", and "Settings" below) --
each is small enough (one hook or none, no filter/pagination state, no
repository calls, no dialog hosting) that a dedicated orchestrator would be
pure ceremony; `TaskViewScreen`/`CalendarScreen`/`ConsolidateScreen`/
`SettingsScreen` own their own small toggle/picker state directly, the same
way `ReportScreen` owns its Share-dialog state.

- `DashboardPage`/`DailyPage` own filter/sort/search/pagination state
  locally — it resets on navigation away and back (acceptable; not
  persisted). "View" navigates to `/reports/[id]` or `/daily/[id]` (a real
  route, not a dialog).
- `WizardPage` takes a `kind: 'weekly' | 'daily'` prop (default `'weekly'`,
  so `/reports/new`/`/reports/:id/edit` are unchanged call sites), loads
  reports itself (both `useReports()` and `useDailyReports()` — the weekly
  wizard needs the full dailies list too, for "Import This Week's Daily
  Reports"), resolves the initial draft (`structuredClone`'d from the
  matching same-kind report on `/reports/:id/edit` or `/daily/:id/edit`,
  exactly like the old `resumeDraft`), and renders `<WizardScreen key={id}>`
  so a fresh "New Report" or "Continue" always remounts with clean internal
  state. An unknown `id` redirects to `/` (weekly) or `/daily` (daily) — it
  never falls through to a blank wizard. The publish-confirmation screen's
  "Download PDF" opens `/reports/[id]/present?print=1` (or
  `/daily/[id]/present?print=1`) in a new tab (real print flow, not a
  dialog); "Copy Share Link" still goes through `ShareDialog` (now
  `kind`-aware too, see `shareLinkFor`).
- The sidebar's Dark Mode switch lives in `components/app/Sidebar.tsx`
  (footer) — it was removed from the dashboard/wizard headers.

## Report screen & presentation deck (Phase 2; interactive deck Phase 5)

- **`components/report/ReportScreen.tsx`** (`/reports/[id]`) is the old
  `ReportDetailDialog` promoted to a full route: same editable
  status/preparedFor/weekStart/weekEnd autosave (via `updateReportFields`,
  "Changes save automatically."), same read-only stats/tasks/risks/
  priorities display, same `dSafe` null-guard -- plus an actions row. Phase
  5 removed the PDF-preview filmstrip (a scaled-down `<ReportDeck>` was bad
  practice); the report screen is now **the working document** (native HTML,
  scrollable, inline-editable). The actions row is now: **Open Presentation**
  (`dark` variant, primary action), Copy Share Link (`outline`), Download
  PDF (`outline`). A "Summary" section kicker was added above the summary
  narrative to match the deck's slide structure.
- **`components/report/ReportDeck.tsx`** is the branded 6-slide deck (Cover,
  Summary + touchpoints, Task Status, Risks & Blockers, Priorities, The
  Win). It always renders brand-light regardless of `data-theme`: its
  `.deck` wrapper class re-declares every semantic token it (and the reused
  Badge/StatCard/Table primitives) reads, back to light-mode values,
  locally overriding whatever `[data-theme='dark']` set upstream.
  `DECK_SLIDE_WIDTH`/`DECK_SLIDE_HEIGHT`/`DECK_SLIDE_COUNT`/`DECK_SLIDE_GAP`
  are exported as the single source of truth for both the CSS (fed in as
  custom properties) and any JS geometry math (present page's responsive
  two-axis fit-scaling); `DECK_TOTAL_HEIGHT` was removed (Phase 5).
  Accepts an optional `activeSlide?: number` prop (0-based index); when
  provided, the deck gains the `deckPaged` modifier class and every slide
  gets `data-active` -- see ReportDeck.module.css.
- **`components/report/PresentScreen.tsx`** (`/reports/[id]/present`) is now
  an **interactive slide-deck route**, not just a static deck + toolbar.
  Phase 5 makes it the shared artifact, replacing the report screen's
  filmstrip as the thing share links open. One slide visible on screen at a
  time (via `@media screen`-scoped hiding rule in ReportDeck.module.css,
  NOT conditional rendering); keyboard navigation (ArrowRight/Down/Space/
  PageDown → next; ArrowLeft/Up/PageUp → prev; Home/End; 1-6 digit keys to
  jump); a bottom `presentNav` overlay bar (Prev/Next buttons, 6 dot
  indicators with `aria-current`, a "n / 6" counter, Fullscreen toggle
  hidden when `!document.fullscreenEnabled`); `?slide=N` deep-link support
  via `history.replaceState`; touch/pen swipe (mouse deliberately excluded
  so text selection doesn't navigate); two-axis fit-to-viewport scaling
  allowing scale > 1 for projectors. **All 6 slides stay permanently mounted
  always** -- "one slide at a time" is a pure `@media screen` hiding rule,
  so print output is completely unaffected by which slide happens to be
  active on screen; see the print.css doc comment and ReportDeck.module.css.
  Conditionally rendering only the active slide is explicitly forbidden
  (window.print() snapshots the DOM synchronously; beforeprint can't
  reliably flush a React re-render first). `?print=1` auto-triggers the
  print dialog after fonts load; which slide was active is irrelevant to
  print (see above). Reads `useSearchParams()` -- its caller wraps this in
  `<Suspense>`. Unknown ids render a branded "Report Not Found" state (no
  sidebar to redirect into).
- **`styles/print.css`** is a plain (non-CSS-Module) global stylesheet,
  imported only by `PresentScreen.tsx`. `@page { size: 1280px 720px;
  margin: 0 }` + fixed `.slide` boxes means the printed page IS the slide
  -- no scaling, no reflow -- so the on-screen deck and "Save as PDF" are
  pixel-identical in Chromium. Every rule is `!important`: Next doesn't
  guarantee this stylesheet loads after the CSS-Module chunks it overrides,
  and without `!important` a source-order flip silently un-hid the toolbar /
  mis-sized the print stage, producing 7-8 PDF pages instead of 6
  (verified with a real Chromium `page.pdf()` export + the PDF's own `/Count`
  page-tree value). `.slide:last-child { break-after: auto }` prevents a
  trailing blank page. **Phase 5 additions**: `.presentNav { display: none }`
  (hides the new overlay in print), and `.presentPage { height: auto;
  display: block }` (because Phase 5 changed `.page` from a growing block to
  a fixed-height flex column on screen, which would collapse the printed
  deck to 1 clipped page if print didn't un-do it; the general rule: any
  screen-only layout property in the present route's ancestor chain must
  have a literal global `present*` classname and a print counter-rule here).
  `ResizeObserver` on the stage div computes the fit scale once on mount and
  re-fires on fullscreen toggle (implemented as a callback ref, not a plain
  useRef, so it fires when the stage DOM node actually mounts/unmounts --
  critical because this component returns `null` until `reports` loads, so
  the plain-ref + useEffect(..., []) pattern would read `stageRef.current`
  as `null` on the only pass the effect runs and never attach the observer).
- **Cross-browser reality (documented, not solved):** custom `@page size`
  is honored by Chromium (Chrome/Edge "Save as PDF", margins None,
  headers/footers off) but ignored by Firefox/Safari, which letterbox/scale
  instead. The present page's toolbar and README both document this.
- **Regonia isn't self-hosted.** `--font-display-serif` (the deck's hero-
  stat font) falls back to Didot/Bodoni/serif. Acceptable for MVP; a
  licensed Regonia woff2 via `next/font/local` is a one-file add later.

## Task and Calendar views (Phase 3)

Both views are pure derivations over `Report[]` -- **no new storage**. The
selectors live in `lib/view-utils.ts` (`allTasks`, `groupTasksByStatus`,
`reportsOverlappingRange`) and `lib/calendar.ts` (date math), written so
they extend cleanly once daily reports (Phase 4, not built here) exist:
`TaskEntry` already carries the *parent report*, and
`reportsOverlappingRange` takes a plain `[startISO, endISO]` range rather
than assuming "week".

- **`components/tasks/TaskViewScreen.tsx`** (`/tasks`) owns a `mode: 'list'
  | 'kanban'` toggle (a `components/ui/Tabs.tsx`, styled as a square-
  cornered segmented control) and derives `entries`/`grouped` via
  `lib/view-utils.ts`. **List** (`TaskList.tsx`) groups every report's
  tasks by status, in the order Blocked → In Progress → Complete, each row
  linking to `/reports/[id]`. **Kanban** (`KanbanBoard.tsx` +
  `KanbanColumn.tsx` + `TaskCard.tsx`) is one `@dnd-kit/core` `DndContext`:
  three `useDroppable` columns keyed by `TaskStatus`, `useDraggable` cards
  keyed by the composite `${reportId}::${taskId}` id (a task's status lives
  on its *parent report*, see `taskCardId.ts`), and a `DragOverlay` for the
  floating card (avoids clip/z-index fights with the shell's scroll
  containers). Dropping a card on a different column calls the new pure
  `withTaskStatus(report, taskId, status)` helper (`lib/report-utils.ts`)
  and feeds the result into `useReports().updateReportFields` (existing
  optimistic update + fresh `updatedAt` + persist) -- no new mutation path.
  Columns derive their own order (report `weekEnd` desc, then task
  `deadline` asc); no intra-column order is persisted.
- **Click vs. drag**: Desktop uses `MouseSensor` with `activationConstraint:
  {distance: 8}` (a plain click never moves the pointer 8px, so dnd-kit
  never starts a drag and the card's `onClick` fires normally). Mobile touch
  uses `TouchSensor` with `activationConstraint: {delay: 250, tolerance: 8}`
  (touch-scroll works freely on a card; a deliberate 250ms press-and-hold
  initiates a drag, paired with `TaskCard.module.css`'s `touch-action:
  manipulation` which lets the browser's native scroll run even while a
  pointer is down on a card). A real drag's trailing click is swallowed by
  dnd-kit itself (a one-shot document `click` listener that stops propagation
  after a drop), so `onClick` never double-fires post-drop. `KeyboardSensor`
  (its default codes: Space/Enter to pick up and drop, arrow keys to move
  between droppables, Escape to cancel) gives the same interaction without
  a pointer -- note this means a focused card's Enter key starts a *drag*,
  not navigation, by dnd-kit's own default keyboard codes.
- **`components/calendar/CalendarScreen.tsx`** (`/calendar`) owns a
  `mode: 'week' | 'month'` toggle (same `Tabs`) plus two independent
  anchors: `weekStart` (always Monday-anchored, `startOfWeekISO`) and
  `monthStart` (always 1st-of-month-anchored, `firstOfMonthISO`), so
  switching tabs never loses your place in the other view. Prev/Next/Today
  operate on whichever anchor is active.
  - **`WeekGrid.tsx`**: a single Mon–Sun 7-column row. Every report
    overlapping the displayed week renders as a bar spanning
    `weekStart→weekEnd`, clipped to the week via ISO `localeCompare`
    (`reportsOverlappingRange`'s convention); each overlapping report gets
    its own row (no lane cap -- a single week has plenty of vertical room).
  - **`MonthGrid.tsx`**: Monday-start, 6-row (42-cell) grid
    (`monthGridDays`), so a Mon–Fri seed week always sits inside a single
    row by construction. Days outside the displayed month render dimmed.
    Each row does real interval-lane packing (`packLanes`): non-overlapping
    report bars share a lane; genuinely overlapping ones stack into new
    lanes. Bars beyond `MAX_VISIBLE_LANES` (2) collapse into a "+N more"
    `components/ui/Popover.tsx` trigger listing the rest -- keeps every
    row a uniform height regardless of report count. (The seed data has no
    naturally overlapping weeks, so this was verified by temporarily
    injecting two overlapping-week draft reports into `localStorage` at
    runtime, confirming the popover appears and lists them, then removing
    them again -- `lib/seed.ts` itself was not touched.)
- **`lib/calendar.ts`** date math uses `Date.UTC(y, m-1, d)` +
  `getUTCDay()`/`getUTCFullYear()`/`getUTCMonth()`/`getUTCDate()` **only** --
  never a local-time `new Date(isoString)` -- so the grid never shifts a day
  depending on the browser's timezone, matching the rest of the codebase's
  "dates are ISO strings, compare with `localeCompare`" rule. "Today" is
  sourced from the existing `nowDate()` (`lib/format.ts`), read once via
  `useState(() => nowDate())` (safe -- both new pages already render
  nothing until `reports !== null`, so this is never the first paint).
- **`@dnd-kit/core@^6.3` + `@dnd-kit/utilities`** (no `@dnd-kit/sortable`,
  no the 0.x `@dnd-kit/react`) installed with **zero peer-dependency
  issues against React 19 / Next 15** -- `npm install` needed no
  `--legacy-peer-deps` flag and no `overrides` entry, same clean result as
  Radix in Phase 1.
- **Dailies aren't surfaced here yet.** `TaskEntry`/`reportsOverlappingRange`
  were deliberately written in Phase 3 to extend cleanly to daily reports
  (see their doc comments in `lib/view-utils.ts`), but wiring
  `DailyReport[]` into these two views was scoped out of Phase 4 as a
  documented follow-up (see "Daily reports & the weekly import (Phase 4)"
  below) rather than risk destabilizing the higher-priority daily
  list/wizard/report/present + weekly-import work. `/tasks` and `/calendar`
  still only ever see weeklies (`useReports()`).

## Daily reports & the weekly import (Phase 4)

**Data model**: `lib/types.ts` is now a discriminated union --
`ReportCore` (every field a weekly and a daily report share) plus
`WeeklyReport` (`kind: 'weekly'`, `weekStart`/`weekEnd`) and `DailyReport`
(`kind: 'daily'`, a single `date`) -- `type AnyReport = WeeklyReport |
DailyReport`. **`type Report = WeeklyReport` is kept as an alias**
specifically so every Phase 1-3 call site (dashboard, weekly wizard, CSV,
report/deck/present, task/calendar views) keeps compiling with near-zero
churn; it's sound because `ReportsRepository.getAll()` is contractually
weeklies-only (`getAllDaily()` is the new daily-only accessor) -- see
`lib/data/reports-repository.ts`. A daily report is **one per day, covering
all clients** (not per-client) -- enforced both in the wizard
(`dailyDateConflict`/`validateStep` in `lib/report-utils.ts`, checked on
`next()`, `publish()`, AND `saveDraft()`) and in SQL (a partial unique index,
see `supabase/migrations/20260717000002_daily_reports.sql`). `Draft` now
carries `kind` plus BOTH `weekStart`/`weekEnd` and `date` unconditionally
(the unused pair is just `''`) -- only `StepBasics` branches on `kind`;
every other wizard step is untouched, which is what makes wizard reuse
between the weekly and daily wizards cheap.

**Storage**: one unified localStorage key, `ff.reports.v2`, holding
`AnyReport[]` (mirrors the single SQL `reports` table -- see
`docs/database-schema.md`). **`LocalStorageReportsRepository`'s v1→v2
migration is the single highest-priority correctness requirement in this
phase**: on first read, if `ff.reports.v2` is absent, it reads the old
`ff.weekly-reports.v1` payload (if present), stamps `kind: 'weekly'` on
every record, and writes it to v2 -- **the v1 key is intentionally left in
place afterward, forever, purely as a backup**, so a bug anywhere in this
migration (or any future v2 consumer) can never actually lose a user's
already-saved reports. If v2 is present but corrupt/unparsable, the same
v1-first recovery runs before falling back to reseeding (which would
discard whatever was in v2) -- reseeding only happens when neither a valid
v2 nor a valid v1 payload exists. `lib/seed.ts` now also seeds 5 daily
reports (`seedDailyReports()`, Mon-Fri 2026-07-13..17 -- the same week as
weekly seed `r7`) with deliberately overlapping `(client, task)` /
`(client, description)` pairs across days, so the aggregator below has real
data to dedupe out of the box.

**Aggregation**: `lib/aggregate.ts`'s `aggregateDailiesIntoDraft(dailies,
draft)` is a pure function (no storage/React) powering the weekly wizard's
"Import This Week's Daily Reports" panel (`StepBasics`, live-recomputed off
the draft's current `weekStart`/`weekEnd` via `useWizard`'s
`weekDailyCount`/`importWeekDailies`): tasks dedupe by `(client, task)` and
risks by `(client, description)` -- reusing the exact predicates already in
`useWizard`'s carry-forward Import panels -- keeping each pair's LATEST
daily's version (status/deadline or severity/nextStep); priorities dedupe
by exact `text`; touchpoints numerics are summed (on top of whatever the
draft already had) and narratives joined with `\n`; the win is the latest
day (scanning newest-first) with a non-empty win, but **only if the draft's
own win is still empty** -- importing never clobbers a win the user already
typed in.

**Repository**: one store, kind-scoped accessors on `ReportsRepository` --
`getAll()` (weeklies only, unchanged semantics), `getAllDaily()` (new),
`getById`/`upsert` (accept/return `AnyReport`), `update` (patch typed
`Partial<ReportCore>`; callers' richer `Partial<WeeklyReport>` /
`Partial<DailyReport>` patches -- e.g. `ReportScreen` editing `weekStart`/
`date` -- are structurally assignable to that narrower parameter type and
still land correctly at runtime, since the implementation spreads `patch`
verbatim). `lib/hooks/useDailyReports.ts` mirrors `useReports.ts` exactly
(same optimistic-update pattern) over `getAllDaily()`.

**Wizard reuse**: `components/wizard/useWizard.ts`, `WizardScreen.tsx`, and
`WizardPage.tsx` are shared verbatim by both wizards via a `kind: 'weekly' |
'daily'` prop (default `'weekly'`) -- `StepBasics` is the only step that
branches on it (single Date field vs. Week Start/End + the import panel);
`saveDraft`/`publish` build a `WeeklyReport` or `DailyReport` off
`draft.kind`. `components/report/ReportScreen.tsx`, `ReportDeck.tsx`, and
`PresentScreen.tsx` are likewise shared via `AnyReport`/`kind` --
`reportPeriodLabel`/`draftPeriodLabel` (`lib/report-utils.ts`) are the
single place "weekly -> `fmtWeekLabel`, daily -> `fmtDateShort`" is decided,
used consistently by the list, wizard, report screen, deck, and CSV export
(`lib/csv.ts`'s `buildAllTasksCsv` now takes `AnyReport[]`; its CSV column
was renamed `Week` -> `Period` to stay accurate for both).

**New surfaces**: `/daily` (`components/daily/DailyPage.tsx` +
`DailyListScreen.tsx`, mirroring `DashboardPage`/`DashboardScreen`) lists
daily reports with a Status filter, pagination, "New Daily Report", and a
CSV export. The sidebar gained a "Daily Reports" nav item
(`components/app/Sidebar.tsx`).

## Zod schemas and Projects (Phase 6a)

**Schema layer**: `lib/schema/` (Zod 4) is now the single source of truth for
domain shapes. `lib/types.ts` is a `z.infer` re-export facade — every import site
is untouched (still `from './types'`), and every inferred type is structurally
identical to the interface it replaced; verified with type-level `Exact<>`
assertions (no type widened, `kind` literals intact). Hand-written UI-only shapes
live in `lib/types.ts` (`BadgeTone` with its faithful-port `'green'` quirk,
`SortKey`, `ReportKind`, `ReportFieldPatch`, `Draft`) because they never cross
a wire or hit storage. **Zod 4, not 3.25**: `@modelcontextprotocol/sdk@1.29`
declares `zod ^3.25 || ^4.0`, and v4 ships `z.toJSONSchema()` natively — Phase 8's
MCP tool input schemas will use it. `lib/schema/index.ts` barrel-exports domain
schemas for validation; `lib/schema/import.ts` (UI-boundary, raw strings) is
deliberately NOT exported through the barrel so its shapes don't pollute the
domain facade. **Zod ships in the client bundle starting Phase 6b** — `lib/import.ts`
imports `AnyReportSchema` as a value for runtime CSV validation, and `CsvImportSection`
is a client component, so zod now lands in `/settings`'s first-load JS (defensible:
validating untrusted CSV genuinely needs runtime schemas client-side).

**Project entity** (`lib/schema/project.ts`): `Project { id, name }` — a real TS
entity now, not just a reference table. Seeded to `ff.projects.v1` from
`lib/seed.ts`'s `seedProjects()` (a verbatim hardcoded copy of the SQL seed so the
two can't drift; NOT derived from `FF_CLIENTS`, which stays the client-string
source for task/risk seeding). Optional `projectId` on `Task`/`Risk`/`ReportCore`/
`Draft` — pure metadata, never replacing the free-text `client` display/dedupe
string. A lazy, change-gated backfill in `LocalStorageReportsRepository.loadAll()`
stamps `projectId` where a task/risk `client` exactly matches a project `name`
(exact-name only, no fuzzy matching, no auto-create). `ff.reports.v2` needed no
key bump — the change is purely additive (a report without `projectId` is still a
valid `AnyReport`). `lib/hooks/useProjects.ts` mirrors `useReports.ts`'s
optimistic-update pattern.

**One daily per day, PER PROJECT BUCKET**: Since imported dailies may share dates
with house dailies, the uniqueness rule became "one per day, per project bucket."
A "bucket" = a project (`projectId` set, for imports) or "house" (`projectId`
NULL, for wizard-authored reports). SQL uses a `coalesce(project_id, '')` expression
index so house rows (NULL `project_id`) fold into the same bucket key and the
constraint is actually enforced for them. A plain `(project_id, report_date)` unique
index would fail for house dailies because Postgres treats NULLs as distinct. The
TS mirror is `sameProjectBucket()` (`lib/report-utils.ts`), used by `dailyDateConflict()`
(wizard validation, checked on `next()`, `publish()`, AND `saveDraft()`) and
`invalidDailyDateEdit()` (the daily report screen's inline Date-field autosave,
a Phase-4 review blocker that must never regress).

## CSV import and consolidation (Phase 6b)

**CSV parsing** (`lib/csv.ts`): `parseCsv(text): string[][]` is a hand-rolled
RFC-4180-subset state machine — doubled-quote escapes, embedded newlines
preserved inside quotes, `\r\n`/`\r` normalized outside quotes, BOM stripped,
trailing blank line ignored. Hand-rolled because the dialect is fully
self-controlled and dependency-light ethos; verified against adversarial
fixtures (unterminated quotes, ragged rows, lone `\r` separators). Both import
templates round-trip byte-identically. **Formula injection neutralization**: a
leading `=`/`+`/`-`/`@`/tab/CR triggers formula evaluation in Excel/Sheets even
inside quoted fields, so `csvEscape` prefixes a literal-text `'` to any such
value. This matters starting Phase 6b: cell content can originate outside the
user's keyboard (imported CSV, possibly LLM-authored) and round-trip back out
into a file someone opens in Excel.

**CSV import** (`lib/import.ts`'s `parseImportCsv(text, targetProjectId, existing)` →
`{reports, issues}`): Header validation is name-exact but order-insensitive
(spreadsheet users reorder columns); unknown columns are genuinely ignored.
Per-row Zod validation via `lib/schema/import.ts`. **All-or-nothing**: any issue
⇒ nothing is persisted, issues accumulate across the whole file rather than
aborting at the first. Row numbers are 1-based INCLUDING the header (matches
spreadsheet gutter). **All ids are freshly generated** — no incoming id is ever
trusted; `report_key` only groups rows within the file and never survives import.
**One import run targets one project** (existing / new / "No project (house
reports)"); a file mixing source projects requires two import runs. Every report
assembled gets the same `projectId` (`targetProjectId`, resolved by the caller
BEFORE parsing).

**Report consolidation** (`/consolidate`, `components/consolidate/ConsolidateScreen.tsx`,
`lib/consolidate.ts`): Three-stage flow — (1) pick a Mon-Sun week (same anchor
pattern as `CalendarScreen`); (2) every weekly/daily report touching that week,
grouped by project bucket, each with an include checkbox (all checked by default);
(3) live merged preview of the checked sources. **"Sanitization" means exactly**:
dedupe disclosure, client-name normalization (exact-after-trim+casefold against
project names, no fuzzy), and empty-row drops. Sources themselves are never
mutated, never re-persisted, never deleted. **"Create Consolidated Weekly Draft"
always CREATES a new `WeeklyReport`** (never edits one) and pushes to
`/reports/[id]/edit` for further editing. Verified sources are byte-unchanged
and no output object shares identity with any source object. Route is
no-orchestrator pattern (like `TaskViewScreen`/`CalendarScreen`/`SettingsScreen`)
because it owns only small state (`weekStart`, checked-source checkboxes,
rename-acceptance toggles); `app/(shell)/consolidate/page.tsx` is a thin wrapper.

**Aggregation generalization** (`lib/aggregate.ts` — `aggregateReportsIntoDraft(sources, draft):
{draft, log}`): Inverted the old `aggregateDailiesIntoDraft` logic: now accepts
ANY `AnyReport[]` and merges them into a draft with a `MergeLogEntry` merge log.
Preserved the Phase-4 asymmetry: tasks/risks are latest-wins (newer source wins
on dedupe), but priorities are **first-wins** (earlier source wins). Sources
order by `reportPeriodEnd` ascending with deterministic tie-break: **on equal
period end a daily outranks a weekly**. `aggregateDailiesIntoDraft` remains as a
one-line wrapper so the Phase-4 wizard call site is untouched — verified via an
oracle script deep-equalling old-vs-new output over seed dailies. The generalized
aggregator is what powers the consolidation preview.

**Batch write path** (`lib/data/reports-repository.ts` + `useReports`/`useDailyReports`):
added `upsertMany()` (one `loadAll()`, one write). The import commit loop originally
fired N fire-and-forget `upsert` calls, each an async read-modify-write, all
resolving against the same pre-import snapshot — last-write-won, so a 5-report
import persisted 1. `upsertMany()` maps to a single transactional insert at the
Supabase cutover.

## Dark mode

`data-theme="dark"` on `<html>` + semantic-token overrides — **not** a
per-component `darkMode` prop threaded through inline styles.

- `styles/tokens/colors.css` (verbatim, do not edit) defines light-mode
  values for the semantic aliases (`--surface-card`, `--text-heading`, ...).
- `styles/theme.css` adds a few more semantic tokens components used to
  hardcode inline (`--surface-field`, `--surface-panel-muted`,
  `--surface-overlay`).
- `styles/theme-dark.css` overrides those same tokens under
  `[data-theme='dark']`.
- `components/theme/ThemeProvider.tsx` is the cross-route source of truth: a
  React context that persists to `localStorage['ff.theme']` and mirrors the
  resolved theme onto `<html data-theme>`. **Phase 5 added a 'system'
  preference.** Consume it via `useTheme()` (returns `{
  preference: 'light'|'dark'|'system', theme: 'light'|'dark',
  setPreference: (p) => void }`). `preference` is what the user picked;
  `theme` is the resolved value actually applied to `data-theme` (never
  'system'). While `preference === 'system'`, a `change` listener on the
  `prefers-color-scheme` media query keeps `theme` live without a reload.
- `app/layout.tsx` inlines a `next/script` (`strategy="beforeInteractive"`)
  that sets `data-theme="dark"` on `<html>` **before hydration** if
  `localStorage['ff.theme'] === 'dark'` OR (`localStorage['ff.theme']` is
  'system' or absent AND the system prefers dark), so a stored or system-dark
  preference never flashes light on first paint. `<html>` has
  `suppressHydrationWarning` for this reason. `ThemeProvider`'s own React
  state always starts with `preference: 'system'` and `theme: 'light'`
  (matching the server) and syncs from `localStorage` in a `useEffect` after
  mount via a `hydrated` guard (never clobbering the pre-hydration attribute
  on the very first commit), so no *React-rendered* control (e.g. the theme
  picker) ever hydrates with mismatched state.
- **Theme control moved to `/settings`** (Phase 5). The Dark Mode switch was
  removed from the sidebar footer. Theme preference is now set on the
  Settings page via three mutually-exclusive buttons (Light / Dark / System).
- **Solid-fill "chrome" elements pair `--text-heading`/`--surface-page`, not
  literal `--ff-black`/`--ff-white`.** Those two tokens are always each
  theme's ink/paper pair (black-on-white in light, white-on-black in dark),
  so e.g. `Button`'s `dark` variant, `Badge`'s `dark` variant, and the
  sidebar's active-nav chip stay visible once the page itself can turn
  black. True brand-constant colors (the `primary` button's green fill, the
  `ghost` button's `--link` hover accent, badge `sage`/positive/negative/
  warning tones) stay literal on purpose — they carry their own contrast
  regardless of theme.

**This supersedes two previously-documented quirks**, both now fixed:
"dark mode is partial by design" and "the header/panel stays white in dark
mode" (prototype line 730's `lightPanelStyle`). Dark mode is now a real,
uniform theme — every surface (tables, cards, inputs, dialogs, the sidebar)
uses real dark surfaces with 1:1 structural parity to light mode; there's no
mode-specific panel wrapper anymore (`rootStyle`, `filterBarStyle`,
`lightPanelStyle`, `panelStyle` were all deleted along with the `darkMode`
prop on every component that only used it for that branching).

## Data plane (Phase 7b)

The entire UI was ported from `localStorage` to a Supabase/Postgres backend
behind the existing `ReportsRepository` interface — zero UI changes. **Demo
mode** (no `NEXT_PUBLIC_SUPABASE_URL` env) still uses localStorage as a
fallback; **Supabase mode** (env configured) uses a new `HttpReportsRepository`
and the Postgres schema versioned in Phase 7a.

**Server layer** (`lib/server/`): `reports-service.ts` is the data-access
layer every route handler and Phase 8's eventual MCP tools call into. Every
exported function takes the Supabase client it must run AS — the module
**never constructs a client itself and must never be handed a service-role
client**. Its correctness assumes RLS (see Phase 7a's
`supabase/migrations/20260719000004_auth_ownership.sql`) is what enforces
access; a service-role client would silently bypass RLS, turning every
function below into an unscoped admin operation. Route handlers pass the
cookie-bound client from `createServerSupabase()` (Phase 7a, `lib/supabase/server.ts`);
Phase 8's MCP tools will pass an api-token-derived, user-scoped client —
same contract, same functions, no service-role key anywhere in this layer.

**Error curation and HTTP contract**:
- `ServiceError` (code + message) is the only exception type this layer throws.
  `mapPgError` routes unexpected Postgres errors → `ServiceError('internal')` →
  HTTP 500 (not 400) — an unrecognized DB error is the server's fault, not a
  malformed request.
- `curatedMessage` translates every `ServiceError.message` (raw Postgres text)
  into user-facing English, exactly once, per error in `route-helpers.ts`. A
  `'conflict'` error pattern-matches the raw text (e.g.
  `reports_one_daily_per_day` constraint name) to distinguish "date already exists"
  from "changed by someone else" — double-curation would flip the message if
  `curatedMessage` was called twice.
- Middleware: unauthenticated `/api/*` returns 401 JSON, not a 307 redirect.
  CSRF guard: Sec-Fetch-Site allowlist + JSON content-type check. Streamed
  body-size limit. Demo-mode misconfiguration guard + banner.

**Timestamp normalization** (`lib/server/db-mapping.ts`): Postgres `timestamptz`
columns return as `"2026-07-13T00:00:00+00:00"` strings. Every read path
normalizes them to ISO date strings (first 10 chars: `"2026-07-13"`) so the
rest of the app sees the same format it did in localStorage mode. No
`new Date()` or timezone math anywhere — dates are ISO strings, compared via
`localeCompare`. This normalization is the single read-side truth, not scattered
across multiple consumers.

**Transport schemas** (`lib/schema/api.ts`): separate from domain schemas, kept
out of the schema barrel. `*InputSchema` variants have `.max()` caps on every
text/numeric field, matching SQL CHECK constraints added in Phase 7b's
hardening migrations. A cap on the READ schema (e.g., `ReportCoreSchema`) was
initially tried and caused a catastrophic DoS: one over-length row in Postgres
would 500 every user's report list (not just the writer's) — the read schema
must stay satisfiable by any valid DB row by construction.

**Route handlers pattern** (`app/api/reports/*`, `app/api/projects/*`):
(1) config guard (is Supabase configured?), (2) auth check (am I signed in?),
(3) Zod validate request body, (4) call service function, (5) `handleServiceError`
routes the result to curated HTTP response. No service-layer error propagates
raw to the client — every error text is curated exactly once before send.

**Repository factory** (`lib/data/index.ts`, `getReportsRepository()`): returns
`HttpReportsRepository` if `NEXT_PUBLIC_SUPABASE_URL` is set, else falls back to
`LocalStorageReportsRepository`. UI code sees no distinction — both implement
the same `ReportsRepository` interface. Migration to Supabase is a single-point
flip.

**HTTP repository** (`lib/data/http-reports-repository.ts`): wraps every
read/write into a fetch call. Writes serialize through one queue — rapid
drag-drop-drag on the Kanban board could trigger multiple concurrent
`updateReportFields` calls, each doing read-merge-write. Without the queue,
each call reads the pre-drag snapshot, merges in its own change, writes back
→ all but the last change is silently lost (classic lost-update race). `upsertMany`
(used by CSV import and localStorage→Postgres bulk import) is one POST →
one transactional insert, not N fire-and-forget calls.

**Hooks failure resilience** (`useReports`, `useDailyReports`, `useProjects`,
all Phase 7b additions): optimistic writes roll back to server truth on
rejection; `loadError` and `mutationError` surface to the UI (show in
`LoadErrorState` for load failures, in the wizard's error banner for mutation
failures). The wizard's publish-confirmation screen only displays after the
write resolves (not before), so a network failure never shows "success" that
didn't actually save.

**Share tokens and cross-machine sharing**: A share link (`/reports/[id]/present?t=<token>`)
resolves via a cookie-less anon Supabase client (`lib/supabase/anon.ts`) — no
session cookies, no JWT, the token is the only key. `PresentScreen` receives a
`shared` prop and ignores the session/hooks path when a token is present (structural
trust boundary). Trying the wrong token on your own report still returns not-found,
even if you're signed in — verified via adversarial testing. The token is 256-bit
entropy, server-generated only, never client-supplied; revocation is instant (a
simple boolean flag). Compensating controls: all tokens are opt-in (no
auto-generation), scoped per-report, short-lived by design (future Phase 9
deploy checklist: scrub `?t=` from access logs). Both present routes set
`referrer: no-referrer` so the token can't leak via the Referer header.

**Share-token security hardening** (Phase 7b post-review BLOCKER): Every
authenticated user could originally read every report's `share_token`. Fixed at
two layers — SQL column-level grant (excludes `share_token` from
`authenticated`'s SELECT; `select *` now fails with 42501) AND an explicit
column list in `reportsQuery` (no `select('*')`). The only read path left is
a new owner-or-admin-gated SECURITY DEFINER RPC (`get_report_share_token`),
called by the new `GET /api/reports/[id]/share` route handler. Verified: direct
PostgREST with anon key + member JWT returns 42501 "permission denied"; the
column is genuinely unreachable outside the owner-gated path.

**Optimistic concurrency** (`expectedUpdatedAt`): `updateReport` (Phase 8 MCP
tool) will support compare-and-swap: "update this report only if `updated_at`
matches my snapshot." `replace_reports` (the transactional upsert function)
server-stamps `updated_at = now()` on both insert and update branches
(fixed in Phase 7b hardening: clients used to be able to backdate it). The TS
side (`createdAt`/`updatedAt`) stays `z.string()` (plain date format from
localStorage, no change), and the read-side normalization step converts
Postgres timestamptz → ISO date string so the comparison works.

**Demo-mode guard** (`components/app/DemoModeBanner.tsx`): in production, if
`NEXT_PUBLIC_SUPABASE_URL` is absent, the banner warns "Running in demo mode
(localStorage only) — Supabase should be configured". Catches accidental
misconfiguration at deploy time.

## Responsive & mobile (mobile P1-P7)

**Intent**: PMs consume/triage reports on a phone; long-form authoring stays desktop,
so the wizard is *usable* on mobile, not optimized for it. The app was 100%
desktop-only until this phase (only `@media` blocks were print-related). Now
mobile-friendly at ≤767px primary breakpoint (secondary ≤1023px for stats layout,
≤640px for present-route navigation).

**Breakpoint & token strategy** (future work must follow this):
- **Responsive spacing** via semantic tokens in `styles/theme.css` — `--page-pad-x`,
  `--page-pad-top`, `--page-pad-bottom`, `--header-pad-y`, `--row-action-pad-mobile`
  — overridden at `:root` inside `@media screen and (max-width: 767px)`. ~10 screen
  modules consume these instead of hardcoding `36px 48px 72px`. Downside:
  `grep 48px` no longer finds page padding; look in `theme.css` instead. This is
  deliberate — it centralizes responsive scalars.
- **Responsive structure** via per-module `@media` with literal px breakpoints. Every
  media query **must be written `@media screen and (…)`.** The `screen and` prefix
  is mandatory — it guarantees a print context can never match a mobile rule (the
  sole exception is `prefers-reduced-motion: reduce`). Omitting `screen` silently
  breaks print (the old all-media print.css rules almost failed for this reason).
- **No CSS-variable media-query conditions**: CSS custom properties are illegal in
  media-query predicates, and CSS Modules have no shared `@custom-media` without a
  new PostCSS dependency (rejected for dependency-light ethos) — which is why
  structural breakpoints stay literal per-module rather than tokenized.

**Navigation & layout** (`components/app/AppShell.tsx`, `MobileNav.tsx`, `Sidebar.tsx`):
- `AppShell` owns a `drawerOpen` client-only state (never persisted, client-only
  interaction). Below 768px the desktop rail (`.desktopSidebar`, hidden by CSS) is
  replaced by a sticky mobile top bar (hamburger `IconMenu` + brand) that opens the
  same `<Sidebar>` in an off-canvas `MobileNav` drawer. `MobileNav` builds the drawer
  directly from raw Radix `Dialog.Root/Portal/Overlay/Content` parts (NOT the higher-level
  `components/ui/Dialog.tsx`, which is a centered fixed-width panel). The drawer renders
  `Sidebar` verbatim so nav items never drift between rail and drawer. `Sidebar` gained
  optional `onNavigate`, `showCollapseToggle`, and `variant` props (drawer mode hides the
  collapse toggle and fills the panel's height).
- `AppShell` closes the drawer on `usePathname()` change (e.g. back/forward navigation)
  and via a `matchMedia('(min-width: 768px)')` listener when the viewport crosses to
  desktop (belt-and-braces: Sidebar's own `onNavigate` already closes on nav click, but
  this covers resize while open).
- `.shell` becomes `display: block` (not a 1-column grid) at ≤767px because a grid
  item's containing block is its grid area, which (a) split `.shell`'s `min-height: 100vh`
  evenly between `.topBar` and `.main`, stretching the top bar to ~half the viewport on
  short pages, and (b) left `.topBar`'s `position: sticky` zero travel. Under block flow,
  the header's containing block becomes `.shell`'s content box, so sticky gets real
  scroll travel. The mobile media query must repeat both `.shell` and `.shell.collapsed`
  selectors because media queries add no specificity — a bare `.shell` rule (0,1,0) would
  lose to `.shell.collapsed { ... 76px 1fr }` (0,2,0) declared above, leaving a phantom
  76px column even with sidebar hidden.
- `MobileNav.module.css` uses `@keyframes` animation (not `transition`) because Radix's
  Presence exit-suspension checks `getComputedStyle(node).animationName` — a plain
  transition would report `'none'` and unmount synchronously with zero exit-animation time.
  Guarded by `@media (prefers-reduced-motion: reduce)` which drops animation outright.

**Table primitive contract** (`components/ui/Table.tsx`, new opt-in props):
- `stacked?: boolean` — opt-in card-stacking at ≤767px (header hidden, every `.tr` becomes
  a bordered card, every `.td` shows its label via `data-label` + `::before`). Strictly
  opt-in so `ReportDeck.tsx`'s `<Table>` calls (which pass neither `stacked` nor `scrollX`)
  keep rendering exact pre-mobile DOM/CSS — **load-bearing for the 6-page print contract**.
- `scrollX?: boolean` — opt-in horizontal-scroll container + a `min-width` floor on the
  table (without it, an auto-layout `width: 100%` table just wraps instead of scrolling).
  Used by Consolidate merge-log (a desktop-leaning audit table). Unconditional (not gated
  to ≤767px) — a no-op if the table already fits.
- `TableColumn.isAction` and `stackedLabel` — marks action columns (right-aligned,
  no generated label) and overrides the label for stacked-mode display only.
- **Critical invariant**: both props are strictly opt-in specifically so the deck's DOM
  stays byte-identical — this protects the 6-page print contract. Per-view treatment:
  Dashboard / Daily / TaskList / Consolidate-sources → `stacked` (triage surfaces, row
  action must be visible without horizontal panning). Consolidate merge-log → `scrollX`
  (audit table, stacking adds noise).

**Kanban touch** (`components/tasks/KanbanBoard.tsx`):
- Split `PointerSensor` into `MouseSensor{distance:8}` + `TouchSensor{delay:250,tolerance:8}`.
  `KeyboardSensor` unchanged.
- `TaskCard.module.css`'s `touch-action: none` → `manipulation` (the real bug fix: `none`
  made the stacked Tasks page unscrollable on touch, since any touch starting on a card
  was captured). `manipulation` disables double-tap-to-zoom only. Net behavior: touch-scroll
  works over cards, a tap navigates, a ≥250ms press-and-hold drags. Pen/stylus still work
  via compat mouse events.
- `user-select: none` / `-webkit-touch-callout: none` scoped to ≤767px only (they existed
  purely to suppress the 250ms long-press text-selection callout; left unscoped, they
  regressed desktop copy-paste on Kanban cards).

**Calendar & Week/Month grids** (`components/calendar/WeekGrid.tsx`, `MonthGrid.tsx`):
- Compress in place at ≤767px (padding/typography only). Rationale: a month is inherently
  7 columns (horizontal scroll breaks gestalt); a 42-row stack is worse. Week bars typically
  span 5–7 columns, staying ~250–340px wide even at 375px viewport.

**Present route** (`components/report/PresentScreen.module.css`):
- `.toolbarHint` (Chromium-print hint) hidden at ≤640px. `.nav` edge-anchored/wrapping
  (12px left/right margins + `bottom: calc(12px + env(safe-area-inset-bottom))` for notched
  devices), larger dot/arrow hit areas (12px dots, 40px arrows). `?print=1` auto-print still
  works.
- `styles/print.css`, `ReportDeck.module.css`, `.page`/`.stage`/`.slideScaler` deliberately
  NOT touched — existing two-axis fit-scaling already degrades correctly on phones
  (≈0.29 portrait, ≈0.44 landscape).

**Ergonomics at ≤767px**:
- `.sm`/`.md` buttons → 44px height (touch target minimum).
- `Input`/`Select`/`Textarea` → 16px font (prevents iOS zoom-on-focus; `maximum-scale=1`
  rejected as a11y violation).
- `Dialog` panel padding 32→20px.
- Wizard stepper labels visually-hidden (clip-path), NOT `display: none`, so screen readers
  still announce step names.

**`app/layout.tsx` viewport export** (new):
- `width: 'device-width'`, `initialScale: 1`, `viewportFit: 'cover'`. Defining ANY `viewport`
  export **replaces** Next's default wholesale (not merged). `viewportFit: 'cover'` is what
  makes `env(safe-area-inset-*)` resolve non-zero on notched/home-indicator devices (used by
  present-route nav bottom offset); `width`/`initialScale` are repeated deliberately to
  preserve Next's own defaults.

## Radix primitives

`components/ui/Dialog.tsx`, `Select.tsx`, `Switch.tsx`, `Tabs.tsx`, and
`Popover.tsx` are rebuilt on the unified `radix-ui` package (`import {
Dialog, Select, Switch, Tabs, Popover, Tooltip, VisuallyHidden } from
'radix-ui'`) — headless behavior, 100% styled by our own CSS Modules
(`className={styles.x}` on each Radix part). No peer-dep issues were hit
installing it against React 19 / Next 15.

- **`Dialog`** keeps its exact `{open, onClose, title, width, children}`
  API — zero call-site churn. Radix's own layered dismiss stack replaces the
  old hand-rolled `dialogStack` module: nested dialogs (e.g. Share opened on
  top of Detail) dismiss top-first with a single Escape, natively, and focus
  is trapped/restored automatically.
- **`Select` changed its `onChange` signature**: `onChange(value: string)`
  (Radix's `onValueChange`), not a `ChangeEvent`. Every call site was
  updated for this — when adding a new `<Select>` usage, write
  `onChange={handler}` or `onChange={(value) => handler(value as T)}`, never
  `(e) => handler(e.target.value)`.
- **`Switch`** is a drop-in a11y upgrade: same `{label, checked, onChange}`
  shape, except `onChange` now receives the next `checked: boolean`
  directly (Radix's `onCheckedChange`), not a `ChangeEvent`.
- The sidebar wraps `<AppShell>` in a single `Tooltip.Provider` (used for
  collapsed-sidebar nav-item labels).
- `ShareDialog`'s `shareLinkFor(reportId)` (Phase 2) returns
  `${window.location.origin}/reports/${id}/present` — SSR-guarded (`window`
  doesn't exist server-side; falls back to a relative path, fine since it's
  only ever rendered/copied client-side).
- **`Tabs`** (Phase 3): a compound `{value, onChange, items: {value, label,
  content}[]}` API (`onChange` follows the same `onValueChange`-as-`value`
  convention as `Select`/`Switch`). Radix leaves an inactive tab's `content`
  genuinely unmounted (not just hidden) unless `forceMount` is passed --
  verified in `@radix-ui/react-tabs`'s source (`children: present &&
  children`) -- which is what keeps the Kanban board's `DndContext` from
  ever mounting while the List tab is selected.
- **`Popover`** (Phase 3): a `{trigger, children, align?}` wrapper, used by
  the Calendar month grid's "+N more" day-overflow disclosure.

## Settings (Phase 5; CSV import Phase 6b)

`/settings` (`components/settings/SettingsScreen.tsx`) provides four sections:

- **Appearance**: a theme picker with three mutually-exclusive buttons (Light /
  Dark / System), wired to `useTheme().setPreference` (replaces the Dark Mode
  switch that used to live in the sidebar footer).
- **Prompt Library**: a static, copy-to-clipboard card list of prompt templates
  for driving reports through the future Claude connector (Phase 8's `app/api/mcp`).
  Tool names referenced here (`list_reports`, `get_report`, `list_projects`,
  `get_week_rollup`, `create_report`, `update_report`, `create_project`,
  `create_weekly_from_dailies`) are the locked contract that Phase 8 and the
  skills/ directory must match exactly (see `lib/prompts.ts` for the full list).
- **CSV Import Templates**: downloadable example CSVs for both weekly and daily
  imports, exercising all four `row_type`s (report, task, risk, priority).
  `lib/csv-templates.ts` exports `IMPORT_COLUMNS` (the exact column order +
  semantics), `buildWeeklyImportTemplateCsv()`, and `buildDailyImportTemplateCsv()`.
  This is a **contract**: Phase 6b's CSV importer must import `IMPORT_COLUMNS`
  from this same module so the contract cannot drift at parse time.
- **CSV Import** (Phase 6b): `CsvImportSection.tsx` — file upload with drag-drop,
  target project picker (existing / new / house), and an async importer UI
  displaying any import issues (accumulated per-file, not abort-on-first) or
  success confirmation. `lib/import.ts`'s `parseImportCsv` is pure (no storage,
  no React); the component reads the file via `FileReader`, resolves/creates the
  target project, persists via `useReports().upsertMany()` if `issues` is empty.

Follows the same pattern as `ReportScreen`/`TaskViewScreen`/`CalendarScreen`: no
separate route-level orchestrator (no filter/sort/pagination state, no hooks),
`SettingsScreen` owns its own small theme-picker and copy-confirmation state
directly, `app/(shell)/settings/page.tsx` is a thin thin wrapper.

## Sidebar & navigation (Phase 5 updates; Phase 6b adds Consolidate)

- `components/ui/icons.tsx` exports hand-authored inline SVG icons
  (`IconDashboard`, `IconDaily`, `IconTasks`, `IconCalendar`, `IconConsolidate`
  (Phase 6b), `IconSettings`, `IconSignOut` (Phase 7a), `IconMenu` (mobile P2)),
  deliberately NOT `lucide-react` (which is stroke-based with round caps/joins,
  fighting this design system's "square corners everywhere" rule). Every icon
  shares a 16×16 viewBox, uses `currentColor` (so the active-nav chip's
  `--text-heading`/`--surface-page` inversion works with zero extra CSS), and
  is marked `aria-hidden`. The sidebar's `.navIcon` slot is now 18×18 (was 8×8).
- `components/app/Sidebar.tsx` gained a "Settings" nav item (Phase 5) and a
  "Consolidate" nav item (Phase 6b); the Dark Mode switch was removed from
  the footer (theme control moved to `/settings`).

## PageHeader (Phase 5)

`components/app/PageHeader.tsx` is a new shared route header (title left, actions
right) that replaced the duplicated per-screen `.header`/`.brand`/`.logo`/
`.wordmark` blocks in `DashboardScreen` and `DailyListScreen`. The brand logo
now lives only in the sidebar. A plain page title is kept (the duplication
complaint was about the brand wordmark repeating in every screen, not titles).
Known follow-up: `TaskViewScreen`, `CalendarScreen`, `WizardScreen`, and
`ReportScreen` still hand-roll near-identical header blocks — the repo currently
has two header idioms; migrating them was out of Phase 5's scope.

## Migrations discipline

**Any PR that changes `lib/schema/` (Zod) or the inferred `lib/types.ts`
domain shapes must add a `supabase/migrations/*.sql` delta and update the
mapping tables in `docs/database-schema.md`.** The baseline schema
(`supabase/migrations/20260717000001_initial_schema.sql`) exists ahead of
the actual Supabase cutover specifically so this discipline starts now,
before there's a repository implementation to keep in sync.

**Phase 4**: `supabase/migrations/20260717000002_daily_reports.sql` — `kind`
discriminant, nullable `report_date`, `reports_period_by_kind` CHECK,
`reports_one_daily_per_day` partial unique index. Authored alongside the
`lib/types.ts` union change.

**Phase 5**: No schema changes — report screen/settings redesign touched no
domain shapes.

**Phase 6a**: `supabase/migrations/20260718000003_projects.sql` — Project
entity, per-project daily buckets, renamed `clients` → `projects`. Alongside
`lib/schema/project.ts` changes.

**Phase 6b**: No schema changes — CSV import/consolidation used Phase 6a's
schema.

**Phase 7a**: `supabase/migrations/20260719000004_auth_ownership.sql` — Auth,
ownership, RLS, per-report share tokens, `replace_reports` RPC, `created_at`/
`updated_at` widened to `timestamptz`, allowed-domain allowlist. No
`lib/types.ts` changes (domain stays `z.string()` for dates).

**Phase 7b**: Two post-review-hardening deltas, no domain shape changes:
  - `supabase/migrations/20260720000005_post_review_hardening.sql` — share-token
    column grant (excludes from `authenticated`'s SELECT), `get_report_share_token`
    SECURITY DEFINER RPC, `replace_reports` server-stamps `updated_at = now()`.
  - `supabase/migrations/20260720000006_post_review_hardening_round2.sql` — length/
    count CHECK constraints matching Zod `*InputSchema` write-boundary caps (id,
    names, narratives, touch counts); child-row-count cap trigger; `replace_reports`
    returns the real `updated_at` it stamped.

## Layout

- `app/` — root layout (fonts, `ThemeProvider`, pre-hydration theme script),
  `(shell)/` route group (see "Routing").
- `styles/tokens/` — brand tokens, copied verbatim from `design-source/tokens/`.
  `styles/theme.css` / `theme-dark.css` — semantic-token light/dark values (see
  "Dark mode"). `print.css` — global rules for the presentation deck.
- `lib/` — `types` (z.infer facade, Phase 6a), `constants`, `format`, `report-utils`,
  `csv` (Phase 6b parsing + escaping), `csv-templates` (Phase 5 import contract),
  `prompts` (Phase 5 prompt library, locked MCP tool names), `seed` (7 weekly +
  5 daily + 4 project seed records), `aggregate` (Phase 4 daily-into-draft, Phase 6b
  generalized), `view-utils`/`calendar` (Phase 3 derivation selectors), `import`
  (Phase 6b CSV importer), `consolidate` (Phase 6b consolidation logic),
  `projects` (Phase 6a project backfill), `data/` (repository interface +
  localStorage impl + HTTP impl (Phase 7b) + factory), `hooks/useReports`, 
  `hooks/useDailyReports` (Phase 4), `hooks/useProjects` (Phase 6a),
  `schema/` (Zod 4, Phase 6a), `server/` (Phase 7b: `reports-service`, 
  `db-mapping`, `route-helpers`, `request-guards`), `supabase/` (Phase 7a: 
  Supabase client factories including `anon.ts` for token-based present routes).
- `components/ui/` — design-system primitives (Button, StatCard, Table, Select,
  Input, Textarea, Checkbox, Switch, Badge, Dialog, Pagination, Tabs, Popover),
  plus `icons.tsx` (hand-authored SVG nav icons, Phase 5).
- `components/theme/` — `ThemeProvider`/`useTheme`.
- `components/app/` — `AppShell`, `Sidebar`, `PageHeader` (Phase 5, replaces
  per-screen brand headers), `MobileNav` (mobile P2, off-canvas drawer).
- `components/dashboard|daily|wizard|dialogs/` — screens + route-level
  orchestration (`DashboardPage`, `DailyPage` (Phase 4), `WizardPage`, now
  `kind`-aware) + `ShareDialog` (the only dialog left; Detail/Pdf dialogs
  were superseded by the report screen + real print flow, see "Report
  screen & presentation deck").
- `components/report/` — `ReportScreen`, `ReportDeck`, `PresentScreen`
  (Phase 2; made interactive Phase 5; generalized to `AnyReport`/`kind` in
  Phase 4, see "Daily reports & the weekly import (Phase 4)").
- `components/tasks/` — `TaskViewScreen`, `TaskList`, `KanbanBoard`,
  `KanbanColumn`, `TaskCard`, `taskCardId` (Phase 3; see "Task and Calendar
  views").
- `components/calendar/` — `CalendarScreen`, `WeekGrid`, `MonthGrid`
  (Phase 3; see "Task and Calendar views").
- `components/consolidate/` — `ConsolidateScreen` (Phase 6b; consolidation UI).
- `components/settings/` — `SettingsScreen` (Phase 5; theme picker, prompt
  library, CSV templates), `CsvImportSection` (Phase 6b; upload + importer UI).
- `styles/print.css` — global print stylesheet for the presentation deck,
  imported only by `PresentScreen.tsx`.
- `supabase/migrations/` — versioned SQL schema (see "Migrations discipline").
- `design-source/` — imported prototype + tokens + backlog (reference only; not shipped).

## Conventions

- **The prototype script block is the behavioral spec — port its logic faithfully,
  don't reinvent.** Line references live in the fable-advisor plan / PROGRESS log.
- Dates are **ISO strings**; compare with `localeCompare`, format via the manual
  parsers in `lib/format.ts`. No `Date`-based timezone math in comparisons.
- Use `var(--token)`; never restate brand hex values in components. Prefer a
  semantic token (`--text-body`, `--surface-card`, ...) over a raw
  `--ff-*` primitive unless the color is genuinely brand-constant (see "Dark
  mode" above).
- Square corners everywhere (0 radius); the wizard stepper circles are the only
  exception (`--radius-pill`).
- Known faithful-port quirks (do not "fix" silently): "Final" status badge renders
  neutral (prototype's `statusTone` returns an undefined tone); `saveDraft`
  always forces `Draft` status. (The two dark-mode quirks previously listed
  here — "dark mode is partial by design" and "header/panel stays white in
  dark" — were intentionally superseded in Phase 1; see "Dark mode" above.)
- **`saveDraft`'s validation scope (Phase 7b)**: The period field(s) — Week
  Start/End for a weekly draft, Date for a daily draft — are the one thing
  `saveDraft()` (`components/wizard/useWizard.ts`) checks before calling
  `onSaveDraft`, with a real inline message ("Add a week start and end date
  before saving a draft." / "Add a report date before saving a draft."),
  rather than letting a period-less draft reach the wire. This is NOT optional
  UX polish: Supabase mode's `isoDate` schema (`lib/schema/api.ts`) and the
  `reports_period_by_kind` CHECK constraint
  (`supabase/migrations/20260717000002_daily_reports.sql`) both reject a blank
  period unconditionally, so a period-less draft would 400 with the raw string
  `Invalid request body.` rendered in the wizard's error banner and nothing
  persisted. Loosening the Zod schema was considered and rejected — the DB
  CHECK constraint would still reject it, just moving the failure one layer
  deeper with a worse error. Every other field (tasks/risks/priorities/
  `preparedFor`) may remain empty on a saved draft. Same scope, same phase:
  clearing a weekly report's Week Start/Week End `<input type="date">` on
  `ReportScreen` (`/reports/[id]`) is rejected client-side too
  (`app/(shell)/reports/[id]/page.tsx`), mirroring the daily report screen's
  pre-existing `invalidDailyDateEdit` blank/collision guard.
- **Share/PDF are no longer mocked (Phase 2)** — superseding the Phase-1
  quirk "Share links and PDF export are UI-only mocked dialogs". Share
  links now resolve to a real route (`/reports/[id]/present`) and PDF
  export is a real browser print flow. **In Supabase mode (Phase 7b)**, share
  links work cross-machine via per-report public tokens (`?t=<token>`) and
  resolve for anonymous recipients on any device. **In demo mode** (no Supabase
  env), the old per-browser limitation still applies — share links require the
  recipient's browser to already have that report in localStorage. Pixel-faithful
  export (`@page` custom size honored, no letterboxing) only works in Chromium
  (Chrome/Edge) — Firefox/Safari ignore custom `@page size` (documented in
  README and the present-route toolbar).

## Gates

```
npm run build && npm run lint && npm run typecheck
```

All three must exit 0 before review/commit. `npm run dev` for manual verification.
