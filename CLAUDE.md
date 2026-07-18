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

- **Now (MVP):** everything local. Data in `localStorage`
  (`ff.reports.v2`), seeded with 7 weekly + 5 daily reports. Share links
  resolve to a real, read-only branded slide-deck route
  (`/reports/[id]/present` or `/daily/[id]/present`); "PDF export" is the
  real browser print flow against that same route (no server-side
  rendering dependency). Task (List/Kanban) and Calendar (Week/Month) views
  (Phase 3) derive from `Report[]` (weeklies only -- no new storage; Phase
  4's dailies are not yet surfaced there, see "Daily reports & the weekly
  import (Phase 4)" below). Phase 4 added daily reports (`/daily/*`) and the
  weekly wizard's "Import This Week's Daily Reports" roll-up.
- **Next:** surface dailies in the Calendar (single-day chips) and Task view
  (tagged by source) -- deliberately deferred out of Phase 4, see "Daily
  reports & the weekly import (Phase 4)" below.
- **Later:** PostgreSQL via Supabase (implement `SupabaseReportsRepository`),
  deploy on Vercel, true cross-machine share links (today's links only
  resolve in a browser whose localStorage already has the report).
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
  reports/[id]/present/page.tsx       # /reports/:id/present     Bare weekly slide-deck route (Phase 2, outside (shell))
  daily/[id]/present/page.tsx        # /daily/:id/present        Bare daily slide-deck route (Phase 4, outside (shell))
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
[id]/page.tsx`, `app/(shell)/tasks/page.tsx`, and `app/(shell)/calendar/
page.tsx` break from that split on purpose (see "Report screen &
presentation deck" and "Task and Calendar views" below) -- each is small
enough (one hook, no filter/pagination state, no dialog hosting) that a
dedicated orchestrator would be pure ceremony; `TaskViewScreen`/
`CalendarScreen` own their own small List/Kanban and Week/Month toggle
state directly, the same way `ReportScreen` owns its Share-dialog state.

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

## Report screen & presentation deck (Phase 2)

- **`components/report/ReportScreen.tsx`** (`/reports/[id]`) is the old
  `ReportDetailDialog` promoted to a full route: same editable
  status/preparedFor/weekStart/weekEnd autosave (via `updateReportFields`,
  "Changes save automatically."), same read-only stats/tasks/risks/
  priorities display, same `dSafe` null-guard -- plus an actions row (Copy
  Share Link, Download PDF, Open Presentation) and a PDF-preview filmstrip.
- **`components/report/ReportDeck.tsx`** is the branded 6-slide deck (Cover,
  Summary + touchpoints, Task Status, Risks & Blockers, Priorities, The
  Win), rendered by BOTH the preview filmstrip and the present route --
  one component, guaranteed parity between what you preview and what you
  print. It always renders brand-light regardless of `data-theme`: its
  `.deck` wrapper class re-declares every semantic token it (and the reused
  Badge/StatCard/Table primitives) reads, back to light-mode values,
  locally overriding whatever `[data-theme='dark']` set upstream.
  `DECK_SLIDE_WIDTH`/`DECK_SLIDE_HEIGHT`/`DECK_SLIDE_COUNT`/
  `DECK_TOTAL_HEIGHT` are exported as the single source of truth for both
  the CSS (fed in as custom properties) and any JS geometry math (preview
  thumbnail sizing, the present page's responsive fit-scale).
- **`components/report/PresentScreen.tsx`** (`/reports/[id]/present`) is the
  bare, read-only route: a screen-only toolbar (Back to Report, Download
  PDF), `?print=1` auto-triggers `window.print()` after the report loads,
  `document.fonts.ready` resolves, and one `requestAnimationFrame` passes.
  Reads `useSearchParams()` -- its caller (`app/reports/[id]/present
  /page.tsx`) wraps it in `<Suspense>`, which Next.js requires for that
  hook or `next build` fails prerendering the route. Unknown ids render a
  branded "Report Not Found" state instead of a redirect (this route has
  no sidebar to redirect back into).
- **`styles/print.css`** is a plain (non-CSS-Module) global stylesheet,
  imported only by `PresentScreen.tsx`. `@page { size: 1280px 720px;
  margin: 0 }` + fixed `.slide` boxes means the printed page IS the slide
  -- no scaling, no reflow -- so the on-screen deck and "Save as PDF" are
  pixel-identical in Chromium. Every rule in it is `!important`: Next
  doesn't guarantee this stylesheet's chunk loads after the CSS-Module
  chunks it overrides, and without `!important` a source-order flip
  silently un-hid the toolbar / mis-sized the print stage in testing,
  producing 7-8 PDF pages instead of 6 (verified with a real Chromium
  `page.pdf()` export + the PDF's own `/Count` page-tree value, both in
  `next dev` and a production `next build`/`next start`). `.slide:last-
  child { break-after: auto }` is what prevents a trailing blank 7th page.
- **Cross-browser reality (documented, not solved):** custom `@page size`
  is honored by Chromium (Chrome/Edge "Save as PDF", margins None,
  headers/footers off) but ignored by Firefox/Safari, which letterbox/scale
  instead. The present page's toolbar says so. No headless-render
  dependency (puppeteer/react-pdf) for this internal tool.
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
- **Click vs. drag**: `PointerSensor` uses `activationConstraint: {distance:
  8}`, so a plain click never moves the pointer 8px and dnd-kit never
  starts a drag -- the card's own `onClick` (navigate to `/reports/[id]`)
  fires normally; a real drag's trailing click is swallowed by dnd-kit
  itself (a one-shot document `click` listener that stops propagation after
  a drop), so `onClick` never double-fires post-drop. `KeyboardSensor` (its
  default codes: Space/Enter to pick up and drop, arrow keys to move
  between droppables, Escape to cancel) gives the same interaction without
  a pointer -- note this means a focused card's Enter key starts a
  *drag*, not navigation, by dnd-kit's own default keyboard codes.
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
  value onto `<html data-theme>`. Consume it via `useTheme()` (`{ theme,
  toggleTheme, setTheme }`).
- `app/layout.tsx` inlines a `next/script` (`strategy="beforeInteractive"`)
  that sets `data-theme="dark"` on `<html>` **before hydration** if
  `localStorage['ff.theme'] === 'dark'`, so a stored preference never
  flashes light on first paint. `<html>` has `suppressHydrationWarning` for
  this reason. `ThemeProvider`'s own React state always starts `'light'`
  (matching the server) and syncs from `localStorage` in a `useEffect` after
  mount, so no *React-rendered* control (e.g. the Dark Mode switch) ever
  hydrates with mismatched state.
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

## Migrations discipline

**Any PR that changes `lib/types.ts` domain shapes must add a
`supabase/migrations/*.sql` delta and update the mapping tables in
`docs/database-schema.md`.** The baseline schema
(`supabase/migrations/20260717000001_initial_schema.sql`) exists ahead of
the actual Supabase cutover specifically so this discipline starts now,
before there's a repository implementation to keep in sync. Phase 4's daily
reports are the first real exercise of this rule:
`supabase/migrations/20260717000002_daily_reports.sql` lands a `kind`
discriminant, a nullable `report_date` column, a `reports_period_by_kind`
CHECK constraint, and the `reports_one_daily_per_day` partial unique index,
authored in the same phase as the `lib/types.ts` union change, not after.

## Layout

- `app/` — root layout (fonts, `ThemeProvider`, pre-hydration theme script),
  `(shell)/` route group (see "Routing").
- `styles/tokens/` — brand tokens, copied verbatim from `design-source/tokens/`.
  `styles/theme.css` / `theme-dark.css` — semantic-token light/dark values (see
  "Dark mode").
- `lib/` — `types`, `constants`, `format`, `report-utils`, `csv`, `seed` (7
  weekly + 5 daily seed reports), `aggregate` (Phase 4 daily-into-draft
  rollup), `view-utils`/`calendar` (Phase 3 derivation selectors), `data/`
  (repository interface + localStorage impl + factory), `hooks/useReports`,
  `hooks/useDailyReports` (Phase 4).
- `components/ui/` — design-system primitives (Button, StatCard, Table, Select,
  Input, Textarea, Checkbox, Switch, Badge, Dialog, Pagination, Tabs, Popover).
- `components/theme/` — `ThemeProvider`/`useTheme`.
- `components/app/` — `AppShell`, `Sidebar`.
- `components/dashboard|daily|wizard|dialogs/` — screens + route-level
  orchestration (`DashboardPage`, `DailyPage` (Phase 4), `WizardPage`, now
  `kind`-aware) + `ShareDialog` (the only dialog left; Detail/Pdf dialogs
  were superseded by the report screen + real print flow, see "Report
  screen & presentation deck").
- `components/report/` — `ReportScreen`, `ReportDeck`, `PresentScreen`
  (Phase 2; generalized to `AnyReport`/`kind` in Phase 4, see "Daily reports
  & the weekly import (Phase 4)").
- `components/tasks/` — `TaskViewScreen`, `TaskList`, `KanbanBoard`,
  `KanbanColumn`, `TaskCard`, `taskCardId` (Phase 3; see "Task and Calendar
  views").
- `components/calendar/` — `CalendarScreen`, `WeekGrid`, `MonthGrid`
  (Phase 3; see "Task and Calendar views").
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
- **Share/PDF are no longer mocked (Phase 2)** — superseding the Phase-1
  quirk "Share links and PDF export are UI-only mocked dialogs". Share
  links now resolve to a real route (`/reports/[id]/present`) and PDF
  export is a real browser print flow, but two things stay genuinely
  limited by this MVP's architecture (document, don't silently "fix"):
  persistence is per-browser `localStorage`, so a shared link only
  resolves in a browser whose local storage already has that report (true
  cross-machine sharing arrives with Supabase); and pixel-faithful export
  (`@page` custom size honored, no letterboxing) only works in Chromium
  (Chrome/Edge) — Firefox/Safari ignore custom `@page size`.

## Gates

```
npm run build && npm run lint && npm run typecheck
```

All three must exit 0 before review/commit. `npm run dev` for manual verification.
