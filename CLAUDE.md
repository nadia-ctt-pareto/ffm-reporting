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

- **Now (WP0 through WP6 complete):** Full stack with optional Supabase backend + Claude connectivity, plus a
  six-package role/team-directory/access-scoping/personal-digest rollout. **WP6: "My Week" / "My Day" export** —
  `/my-week` (a personal digest over the WP4 merged task set: your own reports + tasks you own or are assigned,
  filterable to a single week or, via drill-down, a single day) and its print route `/my-week/present` (a
  synthetic, NEVER-PERSISTED report composed from `blankDraft()`/`aggregateReportsIntoDraft`/`draftToReport`
  and rendered through the unmodified `ReportDeck`/`styles/print.css`); a Mine/Everyone scope toggle, visible
  only for pm+, whose "Everyone" export genuinely includes every teammate's work the viewer's own session can
  already read. See "My Week / My Day export (WP6)" below. Earlier packages in this same rollout: **WP4/WP5:
  merged task surfaces** — `lib/task-merge.ts`'s `mergeTaskSources` is now the ONE shared derivation combining
  a caller's fully-loaded reports with their assigned-elsewhere tasks (WP3's bridge), powering Home's Needs
  Attention, `/tasks`' List/Kanban, and the Calendar's new task-lens layer (`lib/task-calendar.ts`, a
  deadline/created/completed date picker drawing status-toned chips alongside the pre-existing report bars).
  **WP0/WP1: role ladder + team directory** — a
  three-tier `member`/`pm`/`admin` role ladder (`public.role_rank()`/`has_role_at_least()`, infrastructure
  only — no existing policy changed) and a standalone `team_members` directory (list/create/rename/delete,
  admin-gated, Settings → Team tab) with a verified-email self-link RPC for account linking; see "Role ladder
  and team directory (WP0 + WP1)" below. **WP2: task assignee + creation date** — `tasks` gained an optional
  `assigneeId` (FK → `team_members`, `NO ACTION`) and `createdAt` (stamped ONLY at genuine task creation,
  never re-stamped/preserved on a carry-forward/import/aggregation copy); an Assignee picker in both
  `TaskDialog` and the wizard's Task Status step; see "Task assignee and creation date (WP2)" below. **WP3:
  THE ACCESS FLIP** — `reports`/`tasks`/`risks`/`priorities` reads move from org-wide (`using (true)`) to
  owner-or-pm+-or-org-read-token, and every write policy drops its `is_admin()` branch entirely: editing a
  full report is now owner-ONLY, even for a pm/admin (their only other write surface on someone else's report
  is a task they're assigned to, through a new narrow `update_assigned_task()` RPC); delete widens from
  admin-only to pm-or-above. An opt-in, admin-only MCP **org-read scope** on `api_tokens` restores org-wide
  reads for a token that explicitly asks for it, without ever widening its write authority. This migration was
  authored AND verified live against a local Supabase stack (`scripts/verify-access-matrix.ts`, 32/32) — see
  "Scoped access (WP3 — the access flip)" below. **Demo mode**
  (no `NEXT_PUBLIC_SUPABASE_URL` env) runs on `localStorage` (`ff.reports.v2`, projects in `ff.projects.v1`,
  team directory in `ff.team.v1`), seeded with 7 weekly + 5 daily reports + 3 team members; MCP server and
  AI polish 404 in demo mode. **Supabase mode** (env set)
  uses Postgres + HTTP repository with Auth (magic-link sign-in), per-user ownership, RLS, and **cross-machine
  share links** via per-report public tokens. Share links resolve to an interactive branded HTML slide-deck route
  (`/reports/[id]/present` or `/daily/[id]/present`, outside the shell) with keyboard nav, touch swipe, deep links,
  fullscreen, and token-based anon access; "PDF export" is real browser print-to-PDF (exact `buildDeckSlides(report).length` pages in Chromium,
  letterboxed in Firefox/Safari). **Phase 8c: Project (client) management** — `/projects` (list + create) and
  `/projects/[id]` (rename/delete, admin-only; per-project rollup of reports/open tasks/blocked/risks) over the
  existing Project entity; see "Project (client) management (Phase 8c)" below. **Phase 8b: OAuth 2.1 for
  claude.ai** — dynamic client registration + authorization-code+PKCE, layered on Phase 8a's MCP server and
  `api_tokens` table with zero changes to the auth bridge itself. **Phase 8a: Remote MCP server** — Claude Code /
  Desktop / CLI can now read/write reports under the user's own ownership via bearer-token auth; the Skill teaches
  the domain model and workflows. 8 locked tools (list_reports, get_report, list_projects, get_week_rollup,
  create_report, update_report, create_project, create_weekly_from_dailies; no delete_report — and no
  rename_project/delete_project, see Phase 8c's own note on that). **Phase 7c: BYOK AI field polish** — a
  "Polish" button on prose fields in the wizard (summary, win narrative, task title, risk description, etc.),
  powered by BYOK Anthropic key stored encrypted server-side. Earlier phases: Phase 3 added Task view
  (List/Kanban) and Calendar view (Week/Month); Phase 4 added daily reports (`/daily/*`) and weekly-import
  roll-up; Phase 5 added Settings with theme picker, prompt library, CSV templates; Phase 6 refactored to
  Zod (6a), added Project entity (6a), CSV import (6b), consolidation (6b); Phase 7a added Supabase schema +
  Auth; Phase 7b connected UI → Postgres with cross-machine sharing + two adversarial hardening passes.
- **Later:** surface daily-report tasks in Task view and Calendar (documented Phase 4 follow-up); project
  archive (deferred in Phase 8c — delete-when-unreferenced covers the one real need for now); `/tasks`'
  List/Kanban surfacing an assignee filter/group-by (Calendar's own task lens already gained a Team Member
  filter in WP5 — see "My Week / My Day export (WP6)" below for `lib/task-merge.ts`'s shared merge that both
  build on; `/tasks` itself still only offers the Assignee `<Select>` picker WP2 added, no filter); and a
  possible future `list_team_members` MCP read tool (flagged, not decided, by WP2 — see "Task assignee and
  creation date (WP2)" below). WP3's `useAssignedTasks()` plumbing (repository/service/route/hook) is no longer
  un-rendered — WP4 wired it into Home/`/tasks`/Calendar's merged set, and WP6 into `/my-week` — but there is
  still no STANDALONE "only my assigned-elsewhere tasks" list; `/my-week`'s Mine scope is the closest thing
  today (it also includes the viewer's own reports, not just bridge tasks).
- **Deployment (Phase 9):** Vercel deploy, production-hardening checklist (access-log token scrubbing, etc.).
- Post-MVP backlog lives in `design-source/NEXT_STEPS.md` — **out of scope now.**

## Routing

Real App Router routes. Every route lives inside the `(shell)` route group
(a sidebar + content grid) **except** `/reports/[id]/present`,
`/daily/[id]/present`, and (WP6) `/my-week/present`, which deliberately sit
outside it so only the root layout applies (no sidebar on the bare,
shareable/exportable slide-deck routes):

```
app/
  layout.tsx                          # html/body, fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                        # 'use client' -- <AppShell> (sidebar + main)
    page.tsx                          # /                       Home overview (weekly + daily counts, recent, quick actions)
    my-week/page.tsx                  # /my-week                 Personal week/day digest + PDF export (WP6)
    reports/page.tsx                  # /reports                 Weekly report list (was /)
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
    projects/page.tsx                 # /projects                Project list + detail (admin-only rename/delete) (Phase 8c)
    projects/[id]/page.tsx            # /projects/:id             Project detail: rename/delete (admin-only), rollup (Phase 8c)
    settings/page.tsx                 # /settings                Settings (Appearance, Projects, Import, Claude & AI tabs; Theme, Prompts, CSV, MCP, AI polish; Phase 5+)
  reports/[id]/present/page.tsx       # /reports/:id/present     Interactive slide-deck route (Phase 2; made interactive Phase 5, outside (shell))
  daily/[id]/present/page.tsx        # /daily/:id/present        Interactive slide-deck route (Phase 4; made interactive Phase 5, outside (shell))
  my-week/present/page.tsx          # /my-week/present          Synthetic digest print route (WP6, outside (shell), session-gated not token-gated)
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
instead of relying on this. `app/(shell)/my-week/page.tsx` and
`app/my-week/present/page.tsx` (WP6) follow the identical split -- no `[id]`
segment at all (there is no single report to key on; both routes resolve the
digest from the viewer's own session + querystring, see "My Week / My Day
export (WP6)" below) -- and were likewise confirmed collision-free in
`next build`'s route table.

`/tasks` (List/Kanban) and `/calendar` (Week/Month) landed in Phase 3 (see
"Task and Calendar views (Phase 3)" below). `/daily/*` landed in Phase 4
(see "Daily reports & the weekly import (Phase 4)" below).

Route-level orchestration (filter/sort/pagination state, dialog hosting,
`useReports()`/`useDailyReports()` calls) lives in
`components/dashboard/DashboardPage.tsx`, `components/daily/DailyPage.tsx`,
and `components/wizard/WizardPage.tsx`; `app/(shell)/**/page.tsx` files are
thin wrappers around those. `DashboardScreen`/`DailyListScreen`/
`WizardScreen` stay presentational (prop-driven), matching the pre-Phase-1
convention. `app/(shell)/page.tsx` (Home), `app/(shell)/my-week/page.tsx`
(WP6), `app/(shell)/reports/page.tsx`
(weekly list), `app/(shell)/reports/[id]/page.tsx`, `app/(shell)/daily/
[id]/page.tsx`, `app/(shell)/tasks/page.tsx`, `app/(shell)/calendar/
page.tsx`, `app/(shell)/consolidate/page.tsx`, `app/(shell)/settings/page.tsx`,
`app/(shell)/projects/page.tsx`, and `app/(shell)/projects/[id]/page.tsx`
break from that split on purpose (see "Report screen & presentation deck",
"Task and Calendar views", "Consolidation (Phase 6b)", "Settings",
"Project (client) management (Phase 8c)", and "My Week / My Day export
(WP6)" below) -- each is small enough (one
or a few hooks, no filter/pagination state, no dialog hosting beyond what
the screen itself owns) that a dedicated orchestrator would be pure
ceremony; `HomeScreen`/`MyWeekScreen`/`DashboardScreen`/`TaskViewScreen`/`CalendarScreen`/
`ConsolidateScreen`/`SettingsScreen`/`ProjectsScreen`/`ProjectDetailScreen`
own their own small toggle/picker/dialog state directly, the same way
`ReportScreen` owns its Share-dialog state.

- `HomeScreen` (`app/(shell)/page.tsx`) loads `useReports()` and
  `useDailyReports()` once on mount to display stat cards (weekly count,
  daily count, open tasks, blocked) and a recent-reports table linking to
  individual reports.
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
  state. An unknown `id` redirects to `/reports` (weekly) or `/daily` (daily) —
  it never falls through to a blank wizard. The publish-confirmation screen's
  "Download PDF" opens `/reports/[id]/present?print=1` (or
  `/daily/[id]/present?print=1`) in a new tab (real print flow, not a
  dialog); "Copy Share Link" still goes through `ShareDialog` (now
  `kind`-aware too, see `shareLinkFor`). The confirmation screen's copy changed
  from "Back to Dashboard" to "Back to {kindLabel} Reports" (e.g. "Back to
  Weekly Reports"). **Phase 8d (editing a published report)**: `ReportScreen`'s
  actions row gained an ungated "Edit Report" button
  (`${base}/${id}/edit`), so a `Final`/`Sent` report can be resumed through
  this exact same wizard — the machinery already supported resuming a report
  of any status via `reportToDraft`, the only gap was an entry point plus
  correct status handling. `useWizard`'s `saveDraft()`/`publish()` now write
  `draft.status`/`draft.status === 'Sent' ? 'Sent' : 'Final'` respectively
  instead of hardcoded `'Draft'`/`'Final'` literals, so no status is ever
  silently demoted on a resumed report (this supersedes the "`saveDraft`
  always forces `Draft` status" quirk — see "Conventions" below); a brand-new
  or resumed-`Draft` report still writes exactly the same statuses as before.
  `useWizard` exposes `wasPublished` (`initialReport.status !== 'Draft'`,
  captured once at mount) so `WizardScreen`'s copy is resume-aware: header
  wordmark ("Editing Report" vs. "Editing Draft"), the header Save button
  ("Save Changes" vs. "Save Draft"), `StepReview`'s publish button ("Update
  Report" vs. "Publish Report"), and the confirmation screen ("Report
  Updated" vs. "Report Published"). No `expectedUpdatedAt`/CAS was added to
  this write path — the wizard save is a full upsert through
  `POST /api/reports` -> `replace_reports` with no compare-and-swap, the same
  last-write-wins exposure a draft resume already had; the write queue covers
  same-client races and CAS already exists on the PATCH/MCP path for
  cross-client conflicts, so this is a documented limitation, not a gap this
  package closes.

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
- **`components/report/ReportDeck.tsx`** renders a branded slide deck (Phase 8d (deck pagination): dynamic count per report kind and content length; weeklies minimum 6 slides, dailies 5-6 depending on win presence). It always renders brand-light regardless of `data-theme`: its
  `.deck` wrapper class re-declares every semantic token it (and the reused
  Badge/StatCard/Table primitives) reads, back to light-mode values,
  locally overriding whatever `[data-theme='dark']` set upstream.
  `DECK_SLIDE_WIDTH`/`DECK_SLIDE_HEIGHT`/`DECK_SLIDE_GAP`
  are exported as the single source of truth for both the CSS (fed in as
  custom properties) and any JS geometry math (present page's responsive
  two-axis fit-scaling). Accepts an optional `activeSlide?: number` prop (0-based index); when
  provided, the deck gains the `deckPaged` modifier class and every slide
  gets `data-active` -- see ReportDeck.module.css.
- **`components/report/PresentScreen.tsx`** (`/reports/[id]/present`) is now
  an **interactive slide-deck route**, not just a static deck + toolbar.
  Phase 5 makes it the shared artifact, replacing the report screen's
  filmstrip as the thing share links open. One slide visible on screen at a
  time (via `@media screen`-scoped hiding rule in ReportDeck.module.css,
  NOT conditional rendering); keyboard navigation (ArrowRight/Down/Space/
  PageDown → next; ArrowLeft/Up/PageUp → prev; Home/End; 1-9 digit keys to
  jump with in-range guard); a bottom `presentNav` overlay bar (Prev/Next buttons, dot
  indicators (one per slide) with `aria-current`, an "n / N" counter, Fullscreen toggle
  hidden when `!document.fullscreenEnabled`); `?slide=N` deep-link support
  via `history.replaceState`; touch/pen swipe (mouse deliberately excluded
  so text selection doesn't navigate); two-axis fit-to-viewport scaling
  allowing scale > 1 for projectors. **All slides stay permanently mounted
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
  imported only by `PresentScreen.tsx`. **Phase 8d (deck pagination): the print contract is now dynamic.** `@page { size: 1280px 720px;
  margin: 0 }` + fixed `.slide` boxes means the printed page IS the slide
  -- no scaling, no reflow -- so the on-screen deck and "Save as PDF" are
  pixel-identical in Chromium. Every rule is `!important`: Next doesn't
  guarantee this stylesheet loads after the CSS-Module chunks it overrides,
  and without `!important` a source-order flip silently un-hid the toolbar /
  mis-sized the print stage, producing extra PDF pages (verified with real Chromium `page.pdf()` export + the PDF's own `/Count`
  page-tree value). The printed PDF contains exactly `buildDeckSlides(report).length`
  pages -- one page per rendered `.slide`, no more (`.slide:last-child { break-after: auto }` below still prevents a
  trailing blank page regardless of slide count) and no fewer (the fixed 1280x720 boxes + `break-after: page`
  below never merge or collapse two slides onto one page). This is mechanically checkable: `scripts/verify-deck-print.ts`
  imports `buildDeckSlides` and asserts the PDF's page-tree `/Count` equals it.
  **Phase 5 additions** (unchanged in mechanism): `.presentNav { display: none }`
  (hides the overlay in print), and `.presentPage { height: auto;
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

**Task completion date**: `Task` (`lib/schema/report.ts`) also carries an optional
`completedAt` (`isoDateOrEmpty.nullish()` — the same `''` = unset convention
`deadline` uses, purely additive the same way `projectId` is). Auto-stamped to
today's date the moment a task's status becomes `'Complete'` through ANY write
path (wizard Status select, the task modal, a Kanban drag), cleared the moment it
moves back off `'Complete'`, and independently editable afterward — the single
rule lives in `lib/report-utils.ts`'s `taskCompletionStamp`. Powers
`lib/task-schedule.ts`'s Schedule view (`/tasks?view=schedule`) with day-level
(not just week-level) on-time/late classification when a recorded date exists; a
task without one still falls back to the pre-existing week-level inference. See
`docs/database-schema.md`'s "Task completion date" section for the full
cross-layer story (Zod, db-mapping, CSV, MCP).

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
`lib/consolidate.ts`, Navigation IA restructure): Four-step guided wizard —
reuses `components/wizard/WizardStepper.tsx` with custom labels `['Week','Reports','Review','Create']`.
Steps: (1) Pick a week (intro + week toolbar); (2) Choose reports to include (source tables
grouped by project bucket, each with an include checkbox, all checked by default);
(3) Review & clean up (merged stat cards + client-name/empty-row sanitization options +
collapsible "How duplicates were merged" details); (4) Create draft (summary + Create button).
Back/Next footer navigates between steps. **"Sanitization" means exactly**: dedupe disclosure,
client-name normalization (exact-after-trim+casefold against project names, no fuzzy), and
empty-row drops. Sources themselves are never mutated, never re-persisted, never deleted.
**"Create Consolidated Weekly Draft"** button always CREATES a new `WeeklyReport` (never edits
one) and pushes to `/reports/[id]/edit` for further editing. Verified sources are byte-unchanged
and no output object shares identity with any source object. The merge logic (`aggregateReportsIntoDraft`
in `lib/aggregate.ts` and consolidation state in `lib/consolidate.ts`) is unchanged; only the
JSX/UI flow and step partitioning changed. Route is no-orchestrator pattern (like
`TaskViewScreen`/`CalendarScreen`/`SettingsScreen`) because it owns only small state (`weekStart`,
checked-source checkboxes, rename-acceptance toggles); `app/(shell)/consolidate/page.tsx` is
a thin wrapper.

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

## Settings (Phase 5; CSV import Phase 6b; MCP Phase 8a; AI polish Phase 7c; Projects tab Navigation IA restructure; Team tab WP1)

`/settings` (`components/settings/SettingsScreen.tsx`) is now a tab-navigable panel with five tabs
(value/label pairs via `components/ui/Tabs`), supporting `?tab=<value>` deep-linking via
`useSearchParams()` and `history.replaceState`. The route wraps `SettingsScreen` in `<Suspense>`.
Inactive tab panels unmount (Radix `Tabs` default), so per-tab mount-time fetches (Projects data,
Team members, MCP tokens, AI-key status) defer to first open.

- **Appearance**: a theme picker with three mutually-exclusive buttons (Light /
  Dark / System), wired to `useTheme().setPreference` (replaces the Dark Mode
  switch that used to live in the sidebar footer).
- **Projects** (Navigation IA restructure): `ProjectsManager` — self-contained UI to manage
  projects (create, rename, delete). Extracted from the old sidebar nav item and full
  `/projects` route into a Settings tab for project-scoped (vs. report-scoped) workflow.
  The full `/projects` route is retained (no longer in sidebar) for admin deeper inspection.
- **Team** (WP1): `TeamManager` — self-contained UI to manage the Foundation First team
  directory (create/rename/delete, admin-gated including create — see "Role ladder and
  team directory (WP0 + WP1)" above for why Team's RLS diverges from Project's here).
- **Import**: Supabase-only `LocalDataImportSection` (Phase 7b) ensures local reports migrate
  to Postgres on the first run, plus two Phase 6b subsections: **CSV Import Templates**
  (downloadable example CSVs for both weekly and daily imports, exercising all four `row_type`s
  (report, task, risk, priority); `lib/csv-templates.ts` exports `IMPORT_COLUMNS` (the exact
  column order + semantics), `buildWeeklyImportTemplateCsv()`, `buildDailyImportTemplateCsv()`;
  this is a **contract**: the CSV importer must import `IMPORT_COLUMNS` from this same module
  so the contract cannot drift) and **CSV Import** (`CsvImportSection.tsx` — file upload with
  drag-drop, target project picker (existing / new / house), async importer UI displaying
  accumulated issues or success confirmation; `lib/import.ts`'s `parseImportCsv` is pure).
- **Claude & AI** (grouping Phase 8a + 7c): **Prompt Library** (static, copy-to-clipboard card
  list of prompt templates for driving reports through Claude via MCP; tool names are the
  locked contract with Phase 8a's `lib/prompts.ts`), plus Supabase-only **MCP Access**
  (`McpAccessSection.tsx` — bearer-token create/list/revoke, warns when `SUPABASE_JWT_SECRET`
  unset) and **AI Polish** (`AiKeySection.tsx` — BYOK Anthropic key entry, fingerprint +
  timestamps).

Follows the same pattern as `ReportScreen`/`TaskViewScreen`/`CalendarScreen`: no
separate route-level orchestrator, `SettingsScreen` owns its own tab state directly,
`app/(shell)/settings/page.tsx` is a thin wrapper.

## Remote MCP server (Phase 8a)

The app now bridges bearer-token auth into MCP tools, enabling Claude Code, Claude Desktop, and future
claude.ai to read/write reports under the user's own ownership.

**Auth bridge** (`lib/server/mcp-auth.ts`, the security core):
- **Bearer token → JWT pipeline**: `Authorization: Bearer ffmcp_<256-bit-token>` → a SECURITY DEFINER
  `verify_api_token` RPC (called via the bare anon client) that hashes the token, rejects
  revoked/expired matches, stamps `last_used_at`, and returns the owning `user_id` PLUS (WP3) its
  `org_read` scope flag. **All privilege elevation is confined to this single SQL function**. From that id,
  the server mints a 5-minute HS256 JWT signed with the server-only `SUPABASE_JWT_SECRET` (role:
  `authenticated`, NO `app_metadata`, so `is_admin()`/`has_role_at_least()` are structurally false for
  every MCP call — machine tokens are always plain members, even for admin users' tokens; PLUS, WP3, a
  top-level — NOT `app_metadata`-nested — `org_read` claim, reflecting the token's own scope). That JWT
  scopes a per-request Supabase client handed to the tools, so every MCP write runs as the `authenticated`
  role under the **identical RLS** as the web cookie path. No service-role key exists anywhere.
- **Token model** (`app/api/tokens/*`): show-once creation (bearer + secret, user copies the bearer half),
  list (hash-only, never plaintext again), revoke. Tokens never expire by default; offboarding = revoke.
  Hash-only storage (sha-256 hex, matching the `verify_api_token` RPC's own hash algorithm
  byte-for-byte). WP3 adds an admin-only `orgRead` checkbox at creation — see "Scoped access (WP3 — the
  access flip)" below.

**The 8 tools** (`lib/server/mcp-tools.ts`, names locked to `lib/prompts.ts` and machine-checked by
`scripts/check-mcp-tool-contract.ts`):
- **Reads**: `list_reports` (kind/prepared_for/week_start range filter, limit cap), `get_report` (full
  report + `updatedAt`), `list_projects`, `get_week_rollup` (read-only preview: weeklies + dailies for a
  week, same merge rules as consolidation).
- **Writes**: `create_report` (kind-discriminated, refuse-duplicate guard unless `allow_duplicate: true`),
  `update_report` (camelCase, requires `expectedUpdatedAt` for optimistic concurrency — compare-and-swap),
  `create_project` (idempotent by name), `create_weekly_from_dailies` (dailies-only rollup, not weeklies).
- **Deliberately no `delete_report`** — see the Skill's "Access model" section.
- Every tool validates bounded `*InputSchema` (no incoming ids; fresh `uid()` on create). `ServiceError` is
  curated by `curatedMessage` before reaching the MCP client — never raw Postgres errors.
- **Reads scoped to the token's owner by default, writes owner-only always (WP3)**: `list_reports`/
  `get_report`/`get_week_rollup` return only the token owner's own reports UNLESS the token was minted
  with the admin-only org-read scope (`api_tokens.org_read`), in which case they return every report — same
  breadth this bullet originally described before WP3 scoped reads by default. Writes are unaffected either
  way: `create_report`/`update_report`/`create_project`/`create_weekly_from_dailies` only ever touch rows
  the token's owner created, regardless of read scope. Attempting to edit someone else's report returns
  "you don't have permission" — no way around it, including for admin tokens or org-read tokens.

**Transport** (`app/api/[transport]/route.ts`): stateless Streamable HTTP at `/api/mcp`, `withMcpAuth`-gated,
404 in demo mode (no MCP if Supabase not configured or `SUPABASE_JWT_SECRET` unset).

**Token UI** (`components/settings/McpAccessSection.tsx`): create (show-once), list, revoke. Warns when
`SUPABASE_JWT_SECRET` is unset (endpoint not ready for tokens to work yet). Setup instructions included.
WP3 adds an "Org-wide read (admin only)" checkbox (disabled-with-a-hint for a non-admin, the Phase 8c
"disable, don't hide" posture) and a Scope column on the token list.

**The Skill** (`skills/weekly-reports/SKILL.md`): teaches the domain model (weekly/daily discriminant, one
daily per day per project bucket, project vs. house buckets), the access model (WP3: reads scoped to the
token's own owner by default, an admin-only org-read scope for org-wide reads, writes always owner-only, no
admin escalation for tokens, no delete), merge semantics (tasks/risks latest-wins, priorities
first-wins, touchpoints sum, win carries from latest source if draft doesn't have one), the 8 tool reference,
CAS discipline (always read before write, re-read on conflict rather than force), and workflows (draft
roll-up from dailies, weekly status digest, blocker triage, consolidate across projects, CSV import
assistance). Imports `HOUSE_VOICE` from `lib/prompts.ts` (shared with Phase 7c's polish), so the web app
and Claude-via-MCP can never drift into two different voices.

**Dependencies**: `@modelcontextprotocol/sdk@1.26.0` + `mcp-handler@1.1.0` (no hand-rolled MCP, mirroring
the hand-rolled CSV parser's dependency-light ethos elsewhere).

## BYOK AI field polish (Phase 7c; multi-provider generalization Phase 8a)

A "Polish" button on prose fields in the wizard — re-write under Foundation First's house voice via BYOK
key, server-proxied and encrypted at rest. Originally Anthropic-only (Phase 7c); generalized to any provider
(Phase 8a) so users can bring their own key to Anthropic's native API, OpenAI's Chat Completions API, or
any OpenAI-compatible endpoint (OpenRouter, Groq, Together, DeepSeek, Mistral, local models, etc.).

**Provider modes** (`lib/server/ai-polish.ts`):
- **`anthropic`** — native Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`, `x-api-key`
  header), the original Phase 7c behavior. Base URL is hardcoded, never user-controlled.
- **`openai_compatible`** — OpenAI Chat Completions shape (`POST {base_url}/chat/completions`, `Authorization:
  Bearer` header), covering OpenRouter/OpenAI/Groq/Together/DeepSeek/Mistral and most hosted LLM providers.
  User supplies both `base_url` and `model` (required; enforced by SQL CHECK constraint and schema validation).

**Key storage** (`lib/server/ai-crypto.ts` + `lib/server/ai-keys.ts`):
- **Never reaches the browser**: Stored per-user in `ai_keys` table, AES-256-GCM-encrypted under server-only
  `AI_BYOK_ENCRYPTION_KEY` (32 raw bytes, base64-encoded, generated with `openssl rand -base64 32`).
  Plaintext lives ONLY inside `polishField`'s call frame — read once from the encrypted RPC result,
  used for one fetch to the provider, never assigned anywhere else, never logged.
- **Owner-only RLS, no admin branch**: `ai_keys` table RLS is stricter than every other table — deliberately
  no `is_admin()` on any verb. An admin can manage reports but must never read another user's key, even
  as ciphertext (which would be useless without the server-only encryption key anyway).
- **Read RPC** (`get_own_ai_key_ciphertext`): SECURITY DEFINER, `auth.uid()`-scoped (no id param), stamps
  `last_used_at` atomically with the read.
- **Write RPC** (`set_own_ai_key`): Extended signature — `set_own_ai_key(p_key_ciphertext text, p_key_hint
  text, p_provider text default 'anthropic', p_base_url text default null, p_model text default null)`.
  SECURITY DEFINER, validates the key (and base_url/model for `openai_compatible`) against the REAL provider
  BEFORE encrypting/storing (invalid key/endpoint never persists), stamps `validated_at` with server `now()`
  (client clock never trusted). `provider`/`base_url`/`model` are now set atomically alongside the encrypted
  key. The 2-arg overload was explicitly dropped to avoid signature collision.
- **Decrypt failure degrades gracefully**: "re-enter your key" marker, never a 500 or crash.

**SSRF hardening** (`lib/server/ssrf.ts`, applies only to `openai_compatible` mode):
- The `openai_compatible` provider's `base_url` is USER-CONTROLLED and the server makes an outbound fetch to
  it — a critical attack surface. `assertSafeOutboundUrl` gates EVERY fetch (both at save-validation time and
  on every polish call, defense-in-depth).
- **https-only**: Rejects `http://` and every other scheme. Enforced at both schema layer (`SetAiKeyInputSchema`)
  and as the unconditional gate.
- **Known metadata hosts**: Blocks `localhost`/`*.localhost` and cloud-metadata hostnames (`169.254.169.254`,
  `metadata.google.internal`) by name, before any DNS resolution.
- **Private/reserved ranges**: Rejects any IP-literal host or DNS-resolved address falling in:
  - IPv4: `10/8`, `172.16/12`, `192.168/16`, `127/8` (loopback), `169.254/16` (link-local), `0.0.0.0/8`,
    `100.64/10` (CGNAT).
  - IPv6: `::1` (loopback), `::` (unspecified), `fc00::/7` (ULA), `fe80::/10` (link-local), plus all four
    standard embedded-IPv4 forms: IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible (`::a.b.c.d`, deprecated),
    NAT64 (`64:ff9b::a.b.c.d`, RFC 6052 — a real escalation on NAT64-only runtimes), and 6to4
    (`2002:WWXX:YYZZ::`, RFC 3056, embedded address at bits 16-47). Each embedded form is unwrapped and
    re-checked against the same IPv4 ranges.
- **No redirects**: `redirect: 'error'` on every fetch — a provider cannot 3xx this server into an internal
  address after validation passes.
- **DNS-rebinding closure** (SEC-3): validates the addresses, then PINS them into the connection via an `undici`
  `Agent` dispatcher (no second DNS lookup happens at connect time). The validated IPs are returned and fed to
  `buildPinnedDispatcher`, closing the TOCTOU window a naive resolve-then-fetch would leave open. Verified live:
  pinning to the validated address succeeds with normal TLS handshake; pinning to a wrong address times out,
  proving the override takes effect. Uses `undici`'s own exported `fetch`, not Node's global one (identity
  mismatch prevents the global `fetch` from accepting an undici dispatcher).
- **Validation rate-limited**: Both the save-validation call and every polish call run through the same per-user
  rate limiter, preventing external-reachability oracles (distinct error markers + latency leaks for which hosts
  are reachable).

**Per-field registry** (`lib/prompts.ts`, `POLISH_FIELDS` + `HOUSE_VOICE`):
- 7 polishable fields: summary (executive overview), win narrative (story behind the stat), touchpoints
  narrative (communication cadence), risk description (specific, non-alarmist), risk next step
  (action-oriented), priority (verb-first deliverable), task title (normalize messy imports).
- `client` is **hard-excluded** — it's the dedupe key (`(client, task)` / `(client, description)` in
  `useWizard`'s Import panels and `lib/aggregate.ts`). Rewriting it would break dedupe and project
  stamping.
- Each field gets distinct editorial instructions appended to `HOUSE_VOICE` in the system prompt
  (`lib/server/ai-polish.ts`'s `buildSystemPrompt`) — "Polish" means something different for a risk
  description than for a win narrative.
- `HOUSE_VOICE` is the shared house-writing-style constant (concise, concrete, client-appropriate; plain
  business English, active voice, specific outcomes and numbers over vague adjectives; no corporate
  filler, no hype, no exclamation marks, no internal jargon). Verbatim referenced by both the BYOK polish
  system prompt and the MCP Skill's "Voice" section (see above), so the web app and Claude-via-MCP can
  never describe two different voices.

**Polish UX** (`components/ai/PolishButton.tsx`):
- Inline "Polish" button on each polishable field (disabled if no key or encryption key unset).
- Suggestion appears below the field (Accept / Discard / Undo). Original text never touched until Accept.
- Mid-flight edit discards the now-stale suggestion (three guard points), so Accept can never apply a
  rewrite of text the user has since changed.
- `isAiPolishConfigured()`: Supabase configured AND `AI_BYOK_ENCRYPTION_KEY` set → routes exist and
  buttons render. Otherwise, `/api/ai/*` return 404, Settings shows a muted note, demo mode unchanged.

**Polish server** (`lib/server/ai-polish.ts`, model: `claude-sonnet-5`):
- `polishField`: rate-limit check → decrypt key → resolve provider (server-side only) → build system/user
  prompts (same for both providers) → call provider (Anthropic or openai_compatible) → extract/clean result.
  Per-user in-memory rate limiter (10 requests per minute, 2 concurrent max — honest caveat: per-Node-process,
  so multi-instance serverless exceeds limits easily; Redis/Upstash upgrade is the documented path, not built here).
- Response body never logged (can echo back a bad key's last chars). Key never logged. Crypto errors carry no key
  material. Invalid keys validated against the provider before storage. Provider errors mapped to marker tokens
  (`anthropic_invalid_key`/`anthropic_rate_limited`/`anthropic_unavailable`/`anthropic_timeout` for Anthropic;
  `openai_invalid_key`/`openai_bad_endpoint`/`openai_rate_limited`/`openai_unavailable`/`openai_timeout` for
  openai_compatible; `local_rate_limited` for this server's own rate limiter; `ai_key_unreadable` shared),
  then curated by `curatedMessage` in `lib/server/reports-service.ts`.

**Settings** (`components/settings/AiKeySection.tsx`, in Settings' "Claude & AI" tab):
- Provider picker (Anthropic / OpenAI-compatible) determines which validation/polish provider is used.
- Base URL and Model fields appear/required only for `openai_compatible` mode.
- Configured-state display shows provider, model (if set), and masked key hint (never plaintext).
- Key upload validated against the selected provider before storage. Invalid key/endpoint rejected.

**Routes** (`app/api/ai/key/route.ts`, `app/api/ai/polish/route.ts`): gated on `isAiPolishConfigured()`.
GET `/api/ai/key` returns `{ configured, hint, validatedAt, lastUsedAt, provider, model }` (never plaintext).
PUT `/api/ai/key` stores a new plaintext key (validated against the provider first) and provider/base_url/model.
POST `/api/ai/polish` takes a `PolishRequest`, returns `{ polished: string }`.

## Project (client) management (Phase 8c)

The `Project { id, name }` entity (Phase 6a) had every consumer (daily
buckets, CSV import target, consolidation buckets, `projectId` metadata) but
no management UI — Phase 8c adds one: list, create, view, rename, delete.

**THE CRUX — rename safety.** Renaming a project updates **exactly one
field: `projects.name`. Nothing else, ever.**
- `task.client`/`risk.client` strings are historical free text and are
  **NEVER rewritten** on rename — they're the `(client, task)`/`(client,
  description)` dedupe key across `useWizard`, `lib/aggregate.ts`, and
  `lib/consolidate.ts`. Bulk-rewriting them on rename would corrupt that
  dedupe model AND (in Supabase mode) require touching reports the renamer
  doesn't own — an owner-or-admin RLS partial failure mid-rewrite. A
  reviewer should grep any future diff touching this area for a write to
  `task.client`/`risk.client` — there must be none.
- The project `id` is **never** re-slugged on rename (it's the stable FK
  link three tables point at; re-slugging is effectively delete+create and
  breaks all three). A stale slug after a rename is fine — ids are opaque.
- `projectId` is the stable link and survives rename untouched (it's keyed
  on id, never name).
- The one real, visible consequence: the dashboard's client filter used to
  match `task.client === selectedName` — after a rename, filtering by the
  NEW name would miss every pre-rename report. Fixed in
  `DashboardScreen.tsx`'s `filtered` `useMemo` with an id-or-exact-name
  predicate: `t.client === filterClient || t.projectId ===
  projectIdForClientName(filterClient, projects)` (exact match only, no
  fuzzy matching — `projectIdForClientName`, `lib/projects.ts`). Verified
  live (demo mode): rename a project, then filter the dashboard by its NEW
  name — pre-rename reports (whose tasks still carry the OLD `client`
  string but the SAME `projectId`) still show up.

**LOCKED DECISION: rename and delete are ADMIN-ONLY.** `projects_update`/
`projects_delete` RLS (`public.is_admin()`) were already admin-only since
Phase 7a — this phase does NOT loosen them (an earlier draft plan
recommended loosening to all-authenticated; the user explicitly overrode
that). `supabase/migrations/20260724000011_project_management.sql` adds
exactly one thing: a column-level grant so that even an admin can only ever
UPDATE `projects.name`, never `projects.id`, even via raw PostgREST
(`revoke update on projects from authenticated; grant update (name) on
projects to authenticated;`) — verified live via `\dp+ projects` (not
`pg_proc.proacl`, which is the FUNCTION-grant catalog; this is a
TABLE/column grant, a different catalog) and via a raw PostgREST `PATCH
projects?id=eq.<id> {"id":"hacked"}` as `dev@` (admin) returning `42501`.
Safe for `ensureProject` (`lib/server/reports-service.ts`) — it's
INSERT-ON-CONFLICT-DO-NOTHING, never an UPDATE, so it needs no UPDATE
privilege on any column. See `docs/database-schema.md`'s "Project
management (Phase 8c)" for the full verification table (member vs. admin,
raw PostgREST vs. this app's own route, every status code).

Post-review SHOULD-FIX 1: the migration also does `revoke all on
public.projects from anon` — `anon` was otherwise left holding the
Supabase-baseline full-table grant (INSERT/SELECT/UPDATE/DELETE, every
column) even though `projects` has no `anon`-targeted RLS policy at all
(every `projects_*` policy is `to authenticated` only, so this was never
exploitable — a pure grant-hygiene fix closing latent risk before it could
ever matter, matching this schema's established "RLS is not the only gate"
posture, e.g. the `is_admin()` function grant). Verified this doesn't touch
the anon-reachable share/present-route path (`get_shared_report`, a
SECURITY DEFINER function that queries `reports`/`tasks`/`risks` directly
and never touches `projects`, and which runs as its OWNING role regardless
of the caller's own table grants) or `ensureProject`'s create path (always
runs as `authenticated`) — both re-verified live after the revoke.

**UI admin gating** (`components/projects/ProjectDetailScreen.tsx`): in
Supabase mode, `useSession().user.app_metadata?.role === 'admin'` — exactly
what `public.is_admin()` reads server-side — decides whether Rename/Delete
are enabled; a non-admin sees them disabled with an "Admins only" hint
rather than hidden, so the feature isn't a mystery. The server/RLS is the
real control (verified: a non-admin's direct `PATCH`/`DELETE` is rejected —
see the table above); the UI gate is pure UX. **In demo mode**
(`!isSupabaseConfigured()`) there is no session/auth concept at all — this
app's data is per-browser `localStorage`, so `isAdmin` is unconditionally
`true`: full access to your own local data is the sensible default,
documented here rather than left as an unstated assumption.

**Delete = only when unreferenced.** The `reports`/`tasks`/`risks`
`.project_id` FK (`NO ACTION`, no cascade/set-null anywhere in this schema —
supabase/migrations/20260718000003_projects.sql) is the sole authority; a
referenced project's delete fails with sqlstate 23503, curated to "This
project is still referenced by existing reports." (`lib/server/
reports-service.ts`'s `deleteProject` intercepts 23503 before `mapPgError`'s
generic mapping — see that function's own doc comment for why the generic
23503→`'invalid'` mapping is wrong for this one case). Archive is deferred
(not needed for 4 seeded projects; would need a column + Zod + a ripple
through every consumer that currently assumes every project is "live").
`lib/project-view.ts`'s `projectIsReferenced(project, weeklies, dailies)` is
the pure, id-ONLY predicate (deliberately narrower than `projectRollup`'s
id-or-name membership) that mirrors the FK exactly — it's what
`ProjectDetailScreen`'s Delete confirmation uses to disable + explain
BEFORE a doomed request round-trips, so the UI's disabled state and the
server's actual rejection can never disagree. `projectRollup`'s BROADER
id-or-name membership means a project can show associated reports (in its
StatCard/reports table) while still being deletable (`projectIsReferenced`
is false) — the non-referenced delete-confirmation copy calls this out
explicitly (a report that mentions this client by name only, no `projectId`
stamped, keeps its text as-is and is unaffected by the delete) so a PM
isn't surprised by "3 associated reports" next to an enabled Delete button.

**Repository + hook**: `renameProject`/`deleteProject` are explicit
`ReportsRepository` interface methods (not piggybacked on `upsertProject`,
whose insert-or-replace/insert-or-return-existing semantics genuinely
diverge between the two implementations — see that method's own doc
comment). `LocalStorageReportsRepository` re-implements both rules directly
(no RLS/FK to lean on): `renameProject` throws on a missing id or an
existing DIFFERENT project already holding that exact name; `deleteProject`
scans every stored `AnyReport` for a `projectId` reference. `renameProject`
(`useProjects.ts`) keeps the optimistic + rollback + `mutationError`
contract every other mutation here uses — but `deleteProject` does NOT
(post-review SHOULD-FIX 2): it awaits the repository call and only removes
the project from `projects` state on success, never before. This is
deliberate, not an inconsistency — `app/(shell)/projects/[id]/page.tsx`
derives `notFound` from `projects` and redirects to `/projects` the instant
an id disappears from it; an optimistic removal fired that redirect WHILE
the delete request was still in flight, unmounting `ProjectDetailScreen`
before a later rejection could ever render there. Verified live (forced a
delete failure): with the optimistic version, the screen silently bounced
to `/projects` with zero visible error even though nothing was actually
deleted; with the non-optimistic fix, the screen stays mounted and
`deleteError` renders. `ProjectDetailScreen.handleDelete` no longer calls
`router.push` on success either (dropped as redundant, per the same
review) — the route wrapper's own `notFound` effect is the single place
that navigates away after a confirmed delete.

**Shared create-name validation**: `lib/projects.ts`'s
`resolveNewProjectName(rawName, projects)` — promoted out of
`CsvImportSection.tsx`'s `resolveNewProject` (Phase 6b) so the Projects
screen's "New Project" dialog and the CSV importer's "New project…" picker
validate a typed name IDENTICALLY (blank / slugifies to an existing id,
same name / slugifies to an existing id, different name — see that
function's own doc comment for why each case matters). One shared
validator, not two independent reimplementations that could silently
drift; `CsvImportSection.tsx` now imports it instead of hand-rolling its
own copy.

**`lib/project-view.ts`** (pure derivation, style of `lib/view-utils.ts`):
`projectRollup(project, weeklies, dailies)` — every associated report
(id-or-exact-name membership: a task/risk belongs to a project if its
`projectId` matches OR its `client` string still exactly equals the
project's CURRENT name — the same id-or-name posture as the dashboard
filter fix above, for the same reason), open tasks (not yet `'Complete'`),
blocked tasks, and risks. Powers both `/projects`' per-row stats and
`/projects/[id]`'s full detail view. `projectIsReferenced` (id-only, see
above) is the narrower sibling used for the Delete gate.

**Routes**: `/projects` (`components/projects/ProjectsScreen.tsx`) lists
every project with `projectRollup`-derived stats (Name/Reports/Open
Tasks/Blocked/View) and a "New Project" create dialog (create is
all-authenticated, same as CSV import — no admin gating on this screen).
`/projects/[id]` (`components/projects/ProjectDetailScreen.tsx`) is the
name heading, admin-gated Rename/Delete, a StatCard row, the associated
reports table (weeklies + dailies, linking out to `/reports/[id]`/
`/daily/[id]` via `reportPeriodLabel`), and open-task/risk lists. Both
routes are thin `app/(shell)/projects/**` wrappers (no-orchestrator
pattern, like `ConsolidateScreen`) — `app/(shell)/projects/[id]/page.tsx`
redirects to `/projects` on an unknown id, matching `/reports/[id]`'s
precedent.

**No MCP tool changes** — `rename_project`/`delete_project` are
deliberately NOT in the locked 8-tool contract (`lib/prompts.ts`); adding
admin-gated write tools to a bearer-token-authenticated surface (where
every token is a plain `authenticated` member, never admin — see "Remote
MCP server (Phase 8a)" above) was out of scope for this phase and deferred.

## Per-kind report sections, paginated deck, and report delete (Phase 8d)

Four connected workstreams: per-kind section structure, deck pagination (eliminating silent content loss), report delete, and editing published reports.

**Workstream A — per-kind report structure.** Daily and weekly reports no longer share one generic six-section template. The deck now branches on `report.kind`, rendering:
- **Weekly** (6 slides minimum): Cover, "This Week" summary, "Task Status" table, "Risks & Blockers", "Next Week's Priorities", "The Win".
- **Daily** (5-6 slides): Cover, "Day at a Glance" summary, "Tasks by Client" grouped table (not one flat list), "Blockers Needing Attention" risks, "Tomorrow & Follow-Ups" priorities, and "The Win" slide **conditionally omitted** when no win was recorded (see `hasWin`, `lib/report-sections.ts`).

`lib/report-sections.ts` is the SINGLE place both the deck (`lib/deck-slides.ts`) and the report screen (`ReportScreen.tsx`) import per-kind wording (`SECTION_HEADINGS`), so no screen-deck drift is possible. `groupTasksByClient` groups daily tasks by their exact `client` string (not `projectId`, which is metadata) in first-appearance order, matching the `(client, task)` dedupe-key philosophy elsewhere. `hasWin` trims all win fields before testing — a win object that's whitespace-only is empty for display purposes.

**Workstream B — deck pagination.** This landed in two steps: first the slide list became DATA rather than hardcoded JSX (a deliberate no-op refactor — still six slides, still a six-page PDF, verified), and only then did the count start varying with content. Every section now chunks across as many slides as its content actually needs. Measured a real, silent data-loss bug in the prior phase: `.slide { overflow: hidden }` clipped up to 2,018px of tasks, 949px of risks, and 711px of summary prose, never shown to users, never exported to PDF — a realistic 40-task weekly disappeared from its own Task Status slide.

`buildDeckSlides(report)` calls per-section chunkers (`chunkTasks`, `chunkTasksByClient`, `chunkRisks`, `chunkPriorities`, `chunkNarrative`) that pack rows/cards/lines into slides based on `DECK_METRICS` — deterministic height estimation, never DOM measurement (required for SSR token-share path and `?print=1` synchronous snapshot). Constants were live-measured on the real rendered deck via CDP media-emulation (`Emulation.setEmulatedMedia({media:'print'})`) before `getBoundingClientRect()`, not guessed. Two calibration techniques: explicit CSS line-height values resolved directly, and elements with `line-height: normal` measured via isolated clones (with real ancestor context to catch descendant-selector effects). Results are conservative (over-reserve when marginal) — an under-estimate is the content-clipping bug this phase exists to fix. `scripts/verify-deck-print.ts` (Phase 8d's harness) re-verifies the print contract across every fixture and is what catches future drift in these constants — but it must be run by hand (see "The harness is NOT automatic" below).

Slide keys are stable for non-overflowing sections (identical to prior phases, preserving deep links), becoming `${section}-${1-based index}` only when a section spans multiple slides (e.g., `tasks-2` for the second Task Status chunk). Prose narratives chunk at paragraph boundaries first, then sentence fallback, never mid-word. Structured rows (tasks, risks, priorities) are atomic — never split. Client-group headers in daily tasks use `keepWithNext` widow control (never stranded alone at a slide's bottom). Priorities numbering continues across chunks. Continuation slides reserve no space for stat cards (summary/glance) or win stat/label (win) — those fixed blocks live on chunk 1 only.

**Workstream C — report delete.** `deleteReport` service function → `DELETE /api/reports/[id]` route → repository interface + both `localStorage`/HTTP implementations → non-optimistic hook mutation paths on both `useReports` and `useDailyReports` → UI actions on the report screen ("Delete", disabled with a hint when access denied) and a per-row Delete on both list pages. The list-row action exists specifically because a **Draft**'s only other row action is "Continue" — without it, a draft was deletable only by hand-typing its `/reports/[id]` URL. It renders on every row, not only drafts.

`lib/report-access.ts` is the SINGLE predicate (`canDeleteReport`) deciding access, mirroring the `reports_delete` RLS policy verbatim (owner-id match OR, as of WP3, pm-or-above — was admin-only pre-WP3). Demo mode grants full access (localStorage is per-browser). Disabled-with-hint, never hidden. `DELETE_REPORT_HINT` is kept beside the predicate so rule and explanation can never drift. A deleted report's share link degrades to the existing "no longer valid" state (token resolves, report is gone). No migration was needed — `authenticated` role already held DELETE and `reports_delete` RLS already existed (verified live). One ride-along migration (`supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql`) is grant hygiene only and **has been applied to production** (2026-07-22) — RLS already denied `anon`, which has no policy on these tables, so it removed latent risk rather than fixing a live hole.

**Workstream D — editing a published report.** An "Edit Report" button on the report screen reopens the wizard for any report status (Draft, Final, Sent). `reportToDraft` already supported conversion of any status; the gap was an entry point and correct status handling on save. `useWizard`'s `saveDraft()`/`publish()` now write the draft's current status (or `'Sent'` if it was `'Sent'`) instead of hardcoded `'Draft'`/`'Final'` — no status is silently demoted on resume. This supersedes the documented quirk "`saveDraft` always forces Draft status" — see "Conventions" below. **WP3 update**: this button is no longer ungated — `canEditReport` (owner-only, see "Scoped access (WP3 — the access flip)" below) now disables it, with a hint, for anyone but the report's own owner, and `WizardPage` independently redirects away from a direct `/edit` URL visit under the same condition.

**Quality** (what was verified by RUNNING, stated precisely — do not inflate this list):
- All three gates (`npm run build && npm run lint && npm run typecheck`) exit 0.
- `scripts/verify-deck-print.ts`: 8/8 fixtures pass against real generated PDFs. Page counts observed: `baseline-weekly` 6, `baseline-daily` 6, `daily-no-win` 6 (win slide correctly absent), `daily-giant-task-title` 8, `overflow-win-narrative` 9, `daily-many-clients` 11, `overflow-tasks` 12, `overflow-mixed` 16 — each equal to `buildDeckSlides(report).length` as read from the PDF's own page tree. MediaBox `[0 0 960 540]` everywhere (Chromium honoring `@page`, no letterboxing), no clipped content under print-media emulation, no blank slides, no hydration errors.
- The wizard status matrix (7 cases) driven through a real headless browser against the actual wizard in demo mode, asserting the persisted status in `ff.reports.v2` each time. **Wizard path only — the MCP path was not exercised.**
- Report delete driven through a real browser in demo mode: the row disappears, `ff.reports.v2` shrinks by exactly one, zero `/api` calls.
- Both post-review bug fixes were proven by DISABLING the fix and watching the harness fail, not merely asserted: removing `packIntoSlides`'s `onlyWidows` guard makes `daily-giant-task-title` render a blank "Tasks by Client · 1 of 4" page (9 slides instead of 8); stashing the wizard status fix reproduces the Draft-demotion case.

**NOT verified by running** (at the time of Phase 8d): the Supabase owner-or-admin delete round trip (403 vs 204). That needed two real accounts against a live project, and nothing was written to production. **This gap was closed by WP3**: `scripts/verify-access-matrix.ts` ran the delete round trip live against a local Supabase stack (admin's DELETE of a report she doesn't own succeeds; a non-owner/non-pm member's would be denied by the same `reports_delete` policy) — see "Scoped access (WP3 — the access flip)" below.

**Known conservatism**: height estimation deliberately over-reserves (measured slack ~70–112px per task slide) so a marginal section costs one extra slide rather than risking clipping — over-reserving costs a page, under-reserving loses data. Related: `DECK_METRICS` was measured against the WEEKLY dense-table layout but is reused, conservatively, by the daily `tasksByClient` slide's tighter CSS; anyone tightening those constants must re-measure BOTH layouts or the daily deck will clip first while the weekly fixtures still pass.

**The harness runs as a PRE-PUSH GATE** (`.githooks/pre-push`, installed by
`npm run hooks:install`, and automatically via `prepare` on `npm install`).
It is deliberately PATH-SCOPED: it only runs when the commits being pushed
touch a file that can change print output -- `lib/deck-slides.ts`,
`lib/report-sections.ts`, `components/report/*`, `styles/print.css`,
`components/ui/Table*`, or the harness itself. Everything else pushes at full
speed. That scoping is the point: the harness boots a dev server and a
headless Chrome over 8 fixtures and takes minutes, and a multi-minute check on
every push is one that gets `--no-verify`'d within a week.

Run it by hand any time with `npm run verify:print`.

Escape hatches, deliberately provided (a gate with no exit gets disabled
outright): `git push --no-verify` skips all hooks; `SKIP_PRINT_VERIFY=1 git
push` skips just this one. A missing Chrome binary WARNS and allows the push
rather than blocking someone who lacks the optional Puppeteer cache -- the
hook distinguishes "the contract is broken" (exit 1, blocks) from "the check
could not run" (any other exit, warns).

The hook was verified by deliberately breaking the contract and confirming it
blocks -- which caught a real bug in its first version: `if ! cmd; then
status=$?` reads the status of the NEGATION, not the command, so a genuine
failure was misclassified as an infrastructure problem and the push was
allowed. A gate is not a gate until you have watched it fail.

**Migrations**: `supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql` — **applied to production 2026-07-22** via `bash scripts/apply-remote-migrations.sh` (hygiene-only, no functional change). Post-apply verification below.

## Role ladder and team directory (WP0 + WP1)

**WP0 — the role ladder is infrastructure, not a new access rule.** `supabase/
migrations/20260726000015_role_ladder.sql` adds `public.role_rank(text)`
(`IMMUTABLE`; `member`=1, `pm`=2, `admin`=3; any unrecognized value —
typo, NULL, a future/removed tier — degrades to `member`'s rank, 1, never
errors, never escalates) and `public.has_role_at_least(required text)`
(`STABLE`; reads `auth.jwt() -> 'app_metadata' ->> 'role'`, coalesced to
`'member'` when absent). **`is_admin()` (Phase 7a) is UNCHANGED and stays
the enforcement function for every current admin-only policy** —
`has_role_at_least()` is the successor a LATER package (the "RLS access
flip", explicitly out of scope here) will graduate specific policies to, so
they can require "at least `pm`" instead of "exactly `admin`". Both new
functions get the same `revoke ... from public, anon; grant execute ... to
authenticated;` hygiene as `is_admin()`'s own pair.

`lib/roles.ts` is the client mirror: `Role` (`'member' | 'pm' | 'admin'`),
`roleRank()`, `hasRoleAtLeast(user, required)` — reads
`user?.app_metadata?.role`, unrecognized/absent → `'member'`. Carries the
same JWT-staleness caveat `lib/report-access.ts`'s `canDeleteReport` already
documents for `is_admin()`: a role change lands in the affected user's JWT
on their next token refresh (≤ 1h), not immediately.

**Role assignment is out-of-band, by design** — this app never holds a
service-role credential at runtime (`lib/server/reports-service.ts`'s
header comment forbids it outright), so there is no in-app role editor.
`scripts/set-user-role.mjs <email> <member|pm|admin>` is the only way to set
`app_metadata.role`, mirroring `scripts/create-user.mjs`'s `.env.deploy`/
service-role-key conventions.

**WP1 — the team directory.** `supabase/migrations/20260726000016_team_members.sql`
adds a standalone `team_members` table (`id`, `name` unique, `role` CHECK'd
to the same three values as the ladder, `email` unique nullable, `user_id`
unique nullable FK → `auth.users(id)`, `created_at`). RLS: `select` is open
to any authenticated user (a directory, same posture as
`projects_select`/`reports_select`); `insert`/`update`/`delete` are ALL
admin-only (`is_admin()`, unchanged) — this is where WP1 diverges from the
`projects` precedent it otherwise clones: `projects_insert` is open to any
authenticated user, but creating a directory row here is itself a
privileged act (linking `user_id` is effectively priming an access grant, since
a later package makes "the assignee of a task can edit it").

**`team_members.role` is a DIRECTORY LABEL, not the same thing as
`app_metadata.role`, and carries NO permission meaning.** Nothing in this
codebase reads it for any access decision, and nothing ever should — the
enforcement authority is exclusively the JWT. The two CAN drift (an admin
could label someone `'admin'` here while their actual account is still a
plain member) and this is accepted, not a bug: there is no way to avoid it
without either handing the app a service-role credential at runtime
(forbidden) or a SECURITY DEFINER function that lets an admin remotely
mutate ANOTHER user's JWT claims (a much larger escalation surface than a
cosmetic label). The persistent muted note in `components/team/TeamManager.tsx`
states this outright: "Role here is a directory label. Permissions come
from the account's role, which an admin sets outside the app."

**Account linking — verified-email self-link, never a UUID paste box or a
self-claim button.** This app has no service-role key at runtime, so it
cannot list `auth.users` client-side (no admin account picker is
buildable), and a free-typed `user_id` field would let anyone paste an
arbitrary uuid; a "this is me" self-claim button would let anyone claim
ANY unlinked row. Instead: an admin records the person's `email` on the
directory row (inert metadata, independent of that account's real email
until matched); `public.link_my_team_member() returns jsonb` (`SECURITY
DEFINER`, `set search_path = ''`) links the CALLER ONLY — it looks up the
caller's own, Supabase-VERIFIED `auth.users.email` by `auth.uid()` (never a
client-supplied string) and sets `team_members.user_id = auth.uid()` for
the single row whose `email` matches (case-insensitive) AND whose
`user_id is null` — so it can never link the caller to someone else's row,
never re-link an already-linked row, and (via `email unique`) can never
match more than one row. Idempotent by construction: calling it again after
a successful link, or when nothing matches, is a harmless no-op (`NULL`).
Called once, quietly, after sign-in (`components/app/AppShell.tsx`'s
`useEffect`, gated on `isSupabaseConfigured()`) — fire-and-forget, its
rejection swallowed; nothing in WP0/WP1 depends on the link existing yet
(a later package's task-assignee feature will).

**Full entity clone of Project** (same pattern as Phase 8c's Project
management, see that section below): `lib/schema/team.ts` (`TeamMemberSchema`
→ `lib/types.ts`'s `TeamMember`/`TeamMemberRole`), `lib/schema/api.ts`
(`TeamMemberInputSchema`, `TeamMemberRenameInputSchema`), `lib/server/
db-mapping.ts` (`TeamMemberRow`/`rowToTeamMember`/`teamMemberToRow` — the
write-side mapper deliberately never emits `user_id`), `lib/server/
reports-service.ts` (`listTeamMembers`/`ensureTeamMember`/`renameTeamMember`/
`deleteTeamMember`, including a forward-declared sqlstate-23503 interception
on delete even though no FK references `team_members` yet — a later
package's assignee FK needs no service-layer changes, only the migration
adding the FK itself), `app/api/team/route.ts` + `app/api/team/[id]/route.ts`
(the same 5-step shape as `app/api/projects/*`), `lib/data/
reports-repository.ts` + both impls (`getTeamMembers`/`upsertTeamMember`/
`renameTeamMember`/`deleteTeamMember`; localStorage key `ff.team.v1`, seeded
from `lib/seed.ts`'s `seedTeamMembers()` — no `email`/`userId` on any seeded
row, since a fake unverifiable email would defeat the linking design
above), `lib/hooks/useTeamMembers.ts` (clones `useProjects.ts` exactly,
including its non-optimistic `deleteTeamMember`), `components/team/
TeamManager.tsx` (+ CSS — clones `ProjectsManager.tsx`'s self-contained-
manager shape, but INLINES rename/delete into the same table since Team has
no per-member detail route the way Projects has `/projects/[id]`; the
admin-gated "disabled with a hint, never hidden" posture Phase 8c
established now also covers Create, per the RLS divergence above), `lib/
team.ts` (`resolveNewTeamMemberName` — a deliberate, documented near-copy of
`lib/projects.ts`'s `resolveNewProjectName` rather than a shared
generalization, since the two entities' collision rules already diverge —
a team member's `email` is a second uniqueness axis a project has none of),
and a new "Team" tab in `components/settings/SettingsScreen.tsx` (`?tab=team`,
between Projects and Import).

**Role/email are set ONLY at creation** — `renameTeamMember` touches EXACTLY
the `name` column, mirroring `renameProject`'s identical narrow contract.
Editing an existing member's role/email after creation is a deliberate,
locked scope boundary for this package (not an oversight) — a reasonable
follow-up once a real assignee feature makes it urgent.

**Verification**: all three gates, `npm run verify:print` (8/8), and
`npx tsx scripts/check-mcp-tool-contract.ts` (unchanged, 8 tools) all pass.
Both migrations were statically re-read end to end (not applied) confirming
the grant-hygiene/degrade-to-least-privilege/self-link-only/admin-only-RLS
invariants above hold. The Settings → Team tab was driven through a real
browser in demo mode (create → rename → delete, `ff.team.v1` inspected at
each step, duplicate-name creation rejected) — see `docs/database-schema.md`'s
matching section for exactly what was run vs. reasoned about.

## Task assignee and creation date (WP2)

**Status: written but NOT applied** (same posture as WP0/WP1 and
`20260725000014_task_completed_at.sql` — the user applies migrations
themselves). `supabase/migrations/20260726000017_task_assignee.sql` adds
two nullable columns to `tasks`: `assignee_id text references team_members
(id)` (an OPTIONAL FK into WP1's team directory, `NO ACTION` — deliberately,
matching the `project_id` FK precedent on this same table: deleting a
team member who still has tasks assigned must FAIL, not silently orphan
or cascade) and `created_at date` (the day THIS task row was first
authored, same `''` ↔ `NULL` convention `completed_at` already uses). Both
are pure task-ownership/authorship metadata — neither carries any
permission meaning by itself (nothing here grants an assignee special
access to their task's report; that's the explicitly out-of-scope RLS
access flip), and neither replaces `client`. **No RLS policy was touched**
— WP3 (the RLS access flip) owns any future policy change, not this
package.

**Zero changes needed to `curatedMessage`/`deleteTeamMember`.** WP1
forward-declared BOTH sides of this FK before it existed: `deleteTeamMember`
already intercepts sqlstate 23503 itself, and `curatedMessage`'s
`'conflict'` branch already matches `/_assignee_id_fkey|_team_member_id_fkey/`.
Postgres's default constraint-naming convention names this migration's FK
`tasks_assignee_id_fkey`, which that regex matches verbatim — confirmed by
re-reading both functions, neither needed editing.

**`replace_reports` re-declaration**: same reason as every prior delta that
touched a `tasks` column — the function inserts `tasks` via an explicit
column list, so `assignee_id`/`created_at` would silently never persist
through the transactional write path otherwise. Copied from the NEWEST
prior version (`...014`'s, confirmed via `grep -l "create or replace
function public.replace_reports" supabase/migrations/*.sql | tail -1`),
byte-identical except the `tasks` insert also carries the two new columns.

**The `createdAt` design decision (the interesting part of this package).**
`createdAt` is stamped ONLY at genuine creation — `useWizard.ts`'s
`addTask()`, `TaskDialog.tsx`'s Add-mode branch, `lib/import.ts`'s
`buildTask` (one `now` per import batch), `lib/server/mcp-tools.ts`'s
`create_report` (same "one `now` per batch" convention). It is
DELIBERATELY OMITTED — never re-stamped to today, never copied from a
source task — on every path that produces a task COPY from an existing one:
`lib/aggregate.ts`'s `carryForwardUnfinishedTasks` (auto carry-forward on a
new report) and `aggregateReportsIntoDraft`'s merge (the weekly wizard's
daily import, `get_week_rollup`, `create_weekly_from_dailies`,
consolidation), plus `useWizard.ts`'s `importSelectedTasks` (the manual
Import panels). Reasoning: every one of these paths ALREADY mints a fresh
`id` and ALREADY drops `completedAt` outright for the copy — i.e. this
codebase's own established position is that a carried-forward/imported/
aggregated task is a new, independent record sharing only `(client,
task-text)` with its predecessor, not a literal continuation of the same
row. Stamping `createdAt` to TODAY on visibly old, still-open work would
misrepresent it as freshly authored — worse than the honest "not recorded"
this omission leaves it as. Preserving the SOURCE's `createdAt` verbatim
was considered and rejected too: unreliable in general (a source task with
no recorded `createdAt` — every pre-WP2 task, or one that already passed
through this same omission on an earlier hop — has nothing to copy), and it
would be a genuinely new asymmetric rule (nothing else on these paths is
ever "copied from the furthest-back source"). **`assigneeId`, by contrast,
IS carried through verbatim** on all of these paths — durable ownership
metadata like `projectId`, not a point-in-time event, so a task still
unfinished next week almost certainly still belongs to whoever it was
assigned to. See `docs/database-schema.md`'s matching section and the
functions' own doc comments (`lib/aggregate.ts`, `components/wizard/
useWizard.ts`) for the full argument.

**Zod / mapping**: `lib/schema/report.ts`'s `TaskSchema` gains `assigneeId:
z.string().nullish()` (uncapped — the permissive READ schema, per
`ReportCoreSchema`'s own BLOCKER A doc comment) and `createdAt:
isoDateOrEmpty.nullish()`; `TaskInputSchema` (the bounded write boundary)
gains `assigneeId: z.string().max(200).nullish()` and the same `createdAt`.
`lib/schema/api.ts` needed NO changes — `ReportPatchSchema` composes
`TaskInputSchema` through `ReportCoreInputSchema.partial()` automatically.
`lib/server/db-mapping.ts`'s `TaskRow`/`mapTaskRow`/`reportToRow` map both
columns both directions (`assigneeId` follows `projectId`'s `?? undefined`
FK convention; `createdAt` follows `deadline`/`completedAt`'s `?? ''`
date convention). **Deliberately NOT added to `SharedReportJson`/
`get_shared_report`** — an anonymous share-link viewer must never learn
who a task is assigned to or when it was authored, following the exact
precedent `completedAt` already set there.

**UI**: `lib/team.ts` gains three small `<Select>` helpers shared by
`TaskDialog.tsx` and `StepTasks.tsx`'s `TaskRow` — `UNASSIGNED_VALUE` (a
non-empty sentinel, since Radix `Select.Item` rejects `''`, mirroring
`CsvImportSection.tsx`'s `HOUSE_VALUE`), `assigneeSelectOptions`, and
`assigneeSelectValue`/`resolveAssigneeId`. `TaskDialog` gets an
unconditional Assignee field (stamps `createdAt` only on its Add-mode
branch); `StepTasks`' `TaskRow` gets an unconditional Assignee `<Select>`
as a further grid sibling spanning the row's full width — the wizard's
5-column task row was already dense, so this is its own row below, not a
6th column, the same technique the status-gated "Completed On" field
already uses. Both surfaces source the team directory via
`useTeamMembers()` (`TaskViewScreen.tsx`; `WizardPage.tsx` →
`WizardScreen` → `StepTasks`).

**CSV**: `lib/csv-templates.ts`'s `IMPORT_COLUMNS` contract gained NO new
column (extending a locked download-template contract was out of scope) —
every imported task starts unassigned; `createdAt` is still stamped
(app-internal, not spreadsheet-authored).

**MCP**: `create_report`'s task input gains an optional `assignee_id`;
`update_report` inherits both new fields automatically (reuses
`ReportPatchSchema` verbatim). No tool added/renamed/removed —
`scripts/check-mcp-tool-contract.ts` still reports 8, no `delete_report`.
`skills/weekly-reports/SKILL.md` tells a connecting model there is
currently **no `list_team_members` (or equivalent) read tool** — it cannot
resolve a person's name to a directory id, so it must omit `assigneeId`
unless the user (or a prior tool result) supplies a real one, never guess.
**Whether a future `list_team_members` MCP read tool is warranted is an
open question this package flags but does not decide** — a connecting
model currently has no way to assign a task to a named person by request
alone, only by an id the user already has in hand; a small, org-wide,
read-only `list_team_members` tool (mirroring `list_projects`' posture)
would close that gap cheaply, but adding it was out of scope here.

**Verification**: all three gates, `npm run verify:print` (8/8), and
`npx tsx scripts/check-mcp-tool-contract.ts` (8 tools, unchanged) all pass.
The migration was statically re-read end to end (not applied) confirming
the FK's `NO ACTION` behavior, the constraint-name/regex match, and that
`replace_reports` carries both new columns. A real browser (demo mode)
drove: assigning a member in `TaskDialog` persists `assigneeId` to
`ff.reports.v2`; a newly created task gets a `createdAt`; editing an
existing task leaves its `createdAt` untouched; the assignee `<Select>`
lists the seeded team members plus "Unassigned", and picking "Unassigned"
clears a previously-set assignee. See `docs/database-schema.md`'s matching
section for the full story across every layer.

## Scoped access (WP3 — the access flip)

The riskiest package in the RBAC rollout: it changes the READ boundary from
org-wide to scoped, and rewrites the WRITE permission matrix. Read
`supabase/migrations/20260726000018_scoped_access.sql`'s own header comment
alongside this section — it restates the matrix and every rationale below
in more depth, next to the SQL it describes.

**The locked permission matrix**:

| | read | edit | delete |
|---|---|---|---|
| creator (= parent report owner) | yes | yes | yes |
| assignee (of a task) | yes (that task) | yes (that task, NARROW fields) | no |
| pm | ALL | only own/assigned | ALL |
| admin | ALL | only own/assigned | ALL |
| other member | no | no | no |

**TRIPWIRE — read this before touching task/risk/priority creation paths.**
A task's creator is ALWAYS the parent report's owner, because every
task-creation path in this codebase (the wizard, the `/tasks` Add Task
dialog, CSV import, `create_report`/`update_report` MCP tools) writes into
a report the caller already owns. This is why "the creator can edit their
task" needs no `created_by` column — `tasks_update`/`tasks_delete` (and the
`risks`/`priorities` equivalents) key ONLY off the parent report's
`owner_id`, via an `exists (select 1 from reports r where r.id = report_id
and r.owner_id = auth.uid())` subquery. **The day a
non-owner can add a task to someone else's report, this equivalence breaks**
— a reviewer of any future diff that lets caller A write a task/risk/
priority onto caller B's report MUST add a real `created_by` column and
update these policies before merging; until then, assume the parent
report's `owner_id` IS the row's creator, everywhere in this schema.

**Reads**: `reports_select`/`tasks_select`/`risks_select`/`priorities_select`
move from `using (true)` to `owner_id = auth.uid() OR has_role_at_least('pm')
OR token_has_org_read()`. `tasks_select` additionally has an assignee arm
(`exists (select 1 from team_members tm where tm.id = tasks.assignee_id and
tm.user_id = auth.uid())`) — a task's own assignee can see IT (and only it,
via the narrow `list_assigned_tasks()` RPC below, never the raw table) even
on a report they can't otherwise read at all.

**Writes**: every `is_admin()` branch is GONE from `reports_insert`/
`_update`, `tasks_insert`/`_update`/`_delete`, and the `risks`/`priorities`
equivalents — owner-only, full stop. `reports_delete` is the one exception
that WIDENS rather than narrows: `owner_id = auth.uid() OR
has_role_at_least('pm')` (was `... OR is_admin()`) — pm can now delete any
report, matching the matrix's "pm: delete ALL" cell. Assignee writes to a
task NEVER go through the direct `tasks_update` policy (owner-only) — only
through `public.update_assigned_task()`, a narrow, owner-OR-assignee
SECURITY DEFINER RPC that can only ever touch `status`/`deadline`/
`completed_at`, never `task`/`client`/`assignee_id`/`project_id` (the
identity/dedupe fields other people's report chains and this codebase's own
client-string dedupe depend on).

**One daily per (owner, project bucket, day\)** — `reports_one_daily_per_day`
widens from `(project bucket, day)` to also partition by `owner_id`
(`coalesce(owner_id::text, '')`, same NULL-folding treatment `project_id`
already gets): two different people filing their own house daily for the
same date is now legitimate (two different status updates), not a
duplicate — verified live.

**Ownerless rows** (`owner_id` stays nullable — seed rows predate any auth
user): visible only to pm+/org-read tokens now, editable by nobody. Zero
reports exist in production today, so nothing needs migrating.

**MCP org-read scope** (admin-only, opt-in, READ-ONLY). Tokens are
structurally member-tier (Phase 8a — no `app_metadata` on the minted JWT),
so scoping reads by default would silently shrink every existing connector
token to own-reports-only. `api_tokens.org_read boolean default false` is
settable ONLY at creation, ONLY by an admin (`api_tokens_insert`'s `with
check` requires `org_read = false OR has_role_at_least('admin')`, an
RLS-layer gate, not just the Settings checkbox — a non-admin's raw
PostgREST `{org_read: true}` insert is also rejected). `verify_api_token`
widened to return `jsonb {user_id, org_read}` (a return-type change, so the
migration `drop function`s the old one first); `lib/server/mcp-auth.ts`'s
`mintMcpJwt` adds a TOP-LEVEL `org_read` claim (deliberately NOT nested
under `app_metadata`, so it can never make `is_admin()`/`has_role_at_least()`
true and can therefore never touch a write policy — none reference it).
`public.token_has_org_read()` reads that claim and is the extra `or` arm on
every `*_select` policy. **Verified live**: a minted JWT with `org_read:
true` for a plain member could read a report she doesn't own; a PATCH
against that same report with that same JWT still updated zero rows.

**`list_assigned_tasks()`/`update_assigned_task()`** — the assignee's
narrow surface, both new SECURITY DEFINER RPCs, both `authenticated`-only
(anon denied, verified live). `list_assigned_tasks()` takes NO parameters
(re-derives the caller from `auth.uid()` via a `team_members.user_id` join
every call) and returns the caller's assigned tasks joined with BOUNDED
parent-report context (`reportId`/`reportKind`/`weekStart`/`weekEnd`/
`date`/`preparedFor`, plus the owner's team-directory name when linkable) —
**never** sibling tasks, risks, priorities, or the report's narrative; that
omission is the entire trust boundary. `update_assigned_task(p_task_id,
p_status, p_deadline, p_completed_at)` is owner-OR-assignee, narrow-field
only, bumps the parent `reports.updated_at`, and raises 42501 (curated to
"You don't have permission to do that.") for an unknown task or a caller
who is neither owner nor assignee.

**App-side plumbing** (new, ships in this same package): `AssignedTask`/
`AssignedTaskPatch` (`lib/types.ts`, hand-written DTOs — a bespoke RPC join
result, not a stored entity); `AssignedTaskPatchSchema` (`lib/schema/api.ts`,
`.strict()`, status/deadline/completedAt only); `getAssignedTasks`/
`updateTask` on `ReportsRepository` (demo mode's `getAssignedTasks` returns
`[]` unconditionally — no owner/assignee-visibility gap to bridge there);
`GET /api/tasks/assigned` / `PATCH /api/tasks/[id]`; `lib/hooks/
useAssignedTasks.ts` (not yet wired into any screen — this package is the
plumbing, not a new UI surface, see Roadmap's "Later").

**`canEditReport`** (`lib/report-access.ts`) — owner-only, NO pm/admin
branch, mirroring `reports_update` exactly (beside the existing
`canDeleteReport`, now `hasRoleAtLeast(user, 'pm')` instead of an
admin-only check, mirroring `reports_delete`'s widened branch).
`ReportScreen` renders read-only (status/preparedFor/period fields, and
disables "Edit Report") when `!canEdit` — **this is the fix for the exact
failure mode this package exists to prevent**: a pm/admin merely BROWSING a
teammate's report (now legitimately visible under the new `reports_select`)
must never fire a doomed, curated-403 autosave on every keystroke.
`WizardPage` additionally redirects `/reports/[id]/edit`/`/daily/[id]/edit`
to the read-only report screen when the resolved report exists but
`!canEditReport(...)`, so a non-owner can never even reach the fillable
wizard for a report they can't save; `DashboardScreen`/`DailyListScreen`'s
row action reads "Continue" only when both `isDraft` AND editable, else
"View".

**Owner-scoped daily-conflict check** (app-side mirror of the SQL index
above): `lib/report-utils.ts`'s `dailyDateConflict`/`invalidDailyDateEdit`/
`validateStep` gained an optional `currentUserId` (threaded from
`useSession().user?.id` through `WizardPage` → `WizardScreen` → `useWizard`,
and read directly in the daily report screen) — without this, a pm/admin
who now sees every teammate's daily report would get a false "already
exists" against a report they don't own. `sameReportOwner` degrades to "no
conflict ruled out" whenever either side's owner is unknown (demo mode, or
an ownerless legacy row), so every call site that never threads
`currentUserId` is unaffected.

**Verification**: `scripts/verify-access-matrix.ts` ran LIVE against a
local Supabase stack (`supabase start` + `supabase db reset`) and passed
**32/32** — every cell of the matrix above, the org-read scope end to end
(mints a JWT the same shape `mintMcpJwt` would), and the per-owner daily
uniqueness change. All three gates, `npm run verify:print` (8/8), and
`npx tsx scripts/check-mcp-tool-contract.ts` (8 tools, unchanged) also pass.
See `docs/database-schema.md`'s "Scoped access (WP3 — the access flip)"
section for the full per-check results table and exactly how to re-run it.
**Not verified**: this app's own curated HTTP error strings require the
Next dev server running against the same local stack, which this script
does not start — it asserts on the underlying raw Postgres/PostgREST
response those functions curate instead.

## My Week / My Day export (WP6)

The final package in the RBAC/personal-work rollout: a personal digest over
the SAME merged task set every other task-centric surface already shares
(`mergeTaskSources`, `lib/task-merge.ts` — WP4/WP5), filterable to a single
week or, via drill-down, a single day, and exportable as a branded PDF deck
from either.

**`/my-week`** (`components/my-week/MyWeekScreen.tsx`, no-orchestrator
pattern like `TaskViewScreen`/`CalendarScreen`) owns a Monday-anchored week
anchor (`lib/calendar.ts`'s `startOfWeekISO`/`addWeeksISO`/`endOfWeekISO` —
never `Date` math), an optional `?date=` (the day drill-down, synced via
`history.replaceState`, the exact `?tab=`/`?view=` idiom `SettingsScreen`/
`TaskViewScreen` already established — not `pushState`, since a day
drill-down is a client-side filter change, not a browser-history-worthy
"place"; "Whole Week" is an explicit control instead of relying on Back), and
a Mine/Everyone scope (`MyWeekScope`, `lib/my-week.ts`). Week and day are ONE
view, not two: `[rangeStart, rangeEnd]` narrows to a single day or widens to
the whole week, and every stat/table/list reads off that one range — there is
no separate branch to keep in sync.

**Scope** (`lib/my-week.ts`'s `filterReportsByScope`): the toggle renders only
for `hasRoleAtLeast(user, 'pm')` (`lib/roles.ts`) — `false` unconditionally in
demo mode (no session, no roles) and for a plain member, so it's absent
rather than disabled for either audience, and `scope` stays `'mine'` forever
for them, a harmless no-op given what "Everyone" already degrades to (every
report their own session's `useReports()`/`useDailyReports()` calls already
resolve to is already their own, per `reports_select`). For a pm+, "Mine"
reuses `canEditReport` (`lib/report-access.ts`) as the "is this my report"
predicate rather than inventing a second one — WP3 already made report
ownership and report-edit authority the identical owner-only rule; "Everyone"
is a pure pass-through of whatever the session already loaded (org-wide, per
`reports_select`'s pm+ branch). `useAssignedTasks()` (the WP3 bridge) is
never itself narrowed by scope — it already only ever returns the CALLER's
own assigned tasks, so it's "mine" by construction regardless of which scope
is selected; a teammate's own assignment a pm+ can see under "Everyone" comes
through the org-wide report list instead, with its own `canEditAssigned` flag
from `mergeTaskSources`.

**Compose, never modify.** The export is a synthetic, NEVER-PERSISTED
`AnyReport` built by `lib/my-week.ts`'s `buildSyntheticReport`: seed
`blankDraft()`/`blankDailyDraft()` (`lib/report-utils.ts`), run
`aggregateReportsIntoDraft` (`lib/aggregate.ts`, UNMODIFIED — the exact
function `/consolidate` already uses to build a brand-new real report from
many sources) against the scoped, range-filtered `sources`, append
bridge-only tasks (every `MergedTaskEntry` from the caller's own
`mergeTaskSources(sources, ...)` whose `source.canOpen` is false — i.e.
already converted to a plain `Task` and already deduped against `sources` by
the ONE dedupe rule this codebase has for "is this task visible some other
way," not a second independently-written one), then `draftToReport` (also
unmodified). `summaryNarrative` is the one field this function actually
authors — a short, factual, non-editorial sentence ("Consolidated from N
reports covering this week.") describing the composition itself, since
`aggregateReportsIntoDraft` never touches that field and it would otherwise
render silently blank. Pure: never mutates `sources`, mints no repository id,
and its output is never handed to `getReportsRepository()` — the synthetic
report exists only in the memory of whichever tab renders it.

**`/my-week/present`** (`components/my-week/MyWeekPresentScreen.tsx`,
`app/my-week/present/page.tsx`, outside `(shell)`, mirroring
`app/reports/[id]/present/page.tsx`'s pattern) REBUILDS the synthetic report
from scratch on every mount, from the exact same hooks + pure functions
`/my-week` itself uses (`useReports`/`useDailyReports`/`useAssignedTasks`/
`useSession`, `lib/my-week.ts`) — never from localStorage or a global. Only
`weekStart`/`scope`/(optional)`date` travel through the querystring, mirroring
`MyWeekScreen`'s Export button; reloading this exact URL always reconstructs
the identical digest from whatever the viewer's OWN session can currently
see — a pm+'s "Everyone" export genuinely re-reads every report their
session resolves to, not a frozen snapshot from the moment Export was
clicked. Unlike `/reports/[id]/present`, this route carries no share token
and is **not** in `middleware.ts`'s public-path allowlist — an
unauthenticated visit redirects to `/login`, the same as any `(shell)` route,
because this digest is built from the viewer's own session, not a public
per-report token; there is no "anonymous recipient" audience for it the way
there is for a shared report.

**`ReportDeck`/`PresentScreen`/`lib/deck-slides.ts`/`styles/print.css` are
BYTE-UNCHANGED** (confirmed via `git diff --stat`) — this package was
explicitly forbidden from modifying any of them. `MyWeekPresentScreen`
composes the UNMODIFIED, un-paged `ReportDeck` (every slide stacked, the same
rendering mode it has always had when no `activeSlide` is passed) with the
shared `styles/print.css` (imported verbatim) and the exact `?print=1`
auto-print effect `PresentScreen.tsx` established — DUPLICATED (not shared),
specifically because reshaping `PresentScreen` to also accept an
already-built synthetic report (instead of resolving one by `id` against the
real repository/share-token path) was exactly the kind of change this
package was told to stop and report on, not make. `MyWeekPresentScreen`'s own
`.previewWrap` (a screen-only convenience wrapper — centers the deck, scrolls
horizontally on a narrow viewport) is the one new screen-only ancestor
property introduced; it is neutralized by THIS component's OWN
`@media print` rule (`MyWeekPresentScreen.module.css`), not a change to the
shared `print.css` — safe specifically because that rule and its print
counter-rule live in the same file/chunk (deterministic load order, no
cross-stylesheet `!important` fight), unlike the shared print.css's own
reason for existing as a separate global file.

**Sidebar**: a new "My Week" entry (`IconMyWeek`, `components/ui/icons.tsx` —
`IconCalendar`'s frame with a checkmark instead of day-dots) sits right after
Home in `components/app/Sidebar.tsx`'s nav list — both are personal overview
screens, as opposed to the Reports group's per-record browsing.

**Verification**: all three gates (`npm run build && npm run lint && npm run
typecheck`) pass; `npm run verify:print` stays 8/8, unchanged (confirms this
package didn't disturb the existing print contract); `git diff --stat`
against `components/report/ReportDeck.tsx`, `PresentScreen.tsx`,
`lib/deck-slides.ts`, and `styles/print.css` shows zero changes. A throwaway
CDP script (modeled on `scripts/verify-deck-print.ts`, run from the
scratchpad, deleted after) drove real headless Chrome against
`/my-week/present` for BOTH a week export and a day-drill-down export, over a
demo-mode fixture set spanning multiple weekly + daily sources (plus one
report in a different week, to prove the range narrowing that happens
inside the route itself actually excludes it) — every PDF matched
`buildDeckSlides(expectedSyntheticReport).length` (6 pages both times),
`MediaBox [0 0 960 540]`, zero clipped slides, zero blank slides, and
`ff.reports.v2` was read back afterward and found byte-identical to what was
seeded (nothing synthetic persisted, no `'synthetic-my-week'` id ever
appears in it). A second, pure-function throwaway script (no browser)
exercised `reportOverlapsRange`/`reportsInRange`/`assignedTaskOverlapsRange`/
`filterReportsByScope`/`buildSyntheticReport` directly, including the
Mine-vs-Everyone claim specifically: given a two-report fixture owned by two
different users and a Supabase-mode-shaped `ReportAccessContext`, `scope:
'mine'` returned only the caller's own report while `scope: 'everyone'`
genuinely included the other owner's report too — substantiating "a pm's
Everyone export genuinely includes other people's work" at the level this
package's own new logic operates at (the underlying org-wide READ itself —
`reports_select` returning every owner's rows to a pm+ — was already
verified live in WP3's own `scripts/verify-access-matrix.ts`, not re-proven
here). `/my-week` was screenshotted in both light and dark mode (demo mode,
a populated current-week fixture) and confirmed correct dark-mode contrast
throughout (stat cards, the day-picker row's active state, task-status
badges) with zero mode-specific branching in the new code, matching every
other screen in this app. **Not verified live**: an actual multi-account
Supabase session driving the "Everyone" toggle end-to-end through a real
signed-in browser (no local Supabase stack was started for this package,
matching WP3's own documented "must be run by hand against a local stack"
scope boundary) — the pure-function check above is the level of rigor this
package's own new logic warrants, given the underlying multi-user read
behavior it depends on was already verified live one package prior.

## Sidebar & navigation (Phase 5 updates; Phase 6b adds Consolidate; Phase 8a adds MCP; Navigation IA restructure adds Home, collapsible Reports group; WP6 adds My Week)

- `components/ui/icons.tsx` exports hand-authored inline SVG icons
  (`IconHome` (new, Navigation IA restructure), `IconMyWeek` (new, WP6 — `IconCalendar`'s frame with a checkmark
  instead of day-dots), `IconDashboard` (reused for Weekly), `IconChevron` (new, disclosure
  toggle for Reports group), `IconDaily`, `IconTasks`, `IconCalendar`, `IconConsolidate`
  (Phase 6b), `IconSettings`, `IconSignOut` (Phase 7a), `IconMenu` (mobile P2)),
  deliberately NOT `lucide-react` (which is stroke-based with round caps/joins, fighting this
  design system's "square corners everywhere" rule). Every icon shares a 16×16 viewBox, uses
  `currentColor` (so the active-nav chip's `--text-heading`/`--surface-page` inversion works
  with zero extra CSS), and is marked `aria-hidden`. The sidebar's `.navIcon` slot is now
  18×18 (was 8×8). `IconProjects` was removed (no longer in sidebar nav).
- **Navigation structure** (Navigation IA restructure; WP6 adds My Week): Reorganized from a flat list to a hierarchical tree with
  Home (`/`), **My Week** (`/my-week`, WP6 — a personal digest + PDF export, see "My Week / My Day export
  (WP6)" above), a collapsible **Reports** group [Weekly (`/reports`), Daily (`/daily`),
  Tasks (`/tasks`)], Calendar (`/calendar`), Consolidate (`/consolidate`), Settings (`/settings`).
  Projects is no longer in the sidebar; it's now managed via Settings → Projects tab.
- **Disclosure toggle** (Navigation IA restructure): The Reports group is a button with `aria-expanded` +
  `aria-controls="nav-group-reports"` that toggles a persistent `reportsOpen` preference in
  `localStorage['ff.nav-reports-open']` (default open). The DISPLAYED state is `showReports =
  reportsOpen || reportsActive` — auto-reveals the group when any child route is active WITHOUT
  persisting that reveal, so an intentional collapse survives navigating in and out of the
  Reports routes. In the icon-collapsed rail mode, the group FLATTENS to its child icons
  (`.navGroupFlat { display: contents }`) so the disclosure toggle doesn't appear.
- **Active route matching** (Navigation IA restructure): New `isActive(pathname, href)` helper determines nav-item
  highlighting: EXACT match for `/` (Home), prefix-match `href === pathname || pathname.startsWith(href + '/')` for all
  others. The weekly-list route `/reports` now lights the "Weekly" nav item, and `/reports/[id]`
  lights both "Weekly" and its parent "Reports" group.
- `components/app/Sidebar.tsx` gained a "Settings" nav item (Phase 5). The Dark Mode switch was
  removed from the footer (theme control moved to `/settings`). Navigation IA restructure adds the collapsible
  group, new nav data model (`NavLeaf | NavGroup`, with `isGroup` narrowing), and the disclosure
  toggle.

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

**Phase 8a**: `supabase/migrations/20260721000007_mcp_tokens.sql` — `verify_api_token`
SECURITY DEFINER RPC (the entire auth bridge for bearer tokens), `api_tokens` table
enhancements (`created_at`, `last_used_at`, `expires_at`, `revoked_at`), RLS
(owner-only on all verbs; no update policy — tokens are create/revoke only).

**Phase 7c**: `supabase/migrations/20260722000008_ai_keys.sql` — `ai_keys` table
(user_id, key_ciphertext, key_hint, created_at, updated_at, validated_at, last_used_at),
`get_own_ai_key_ciphertext()` and `set_own_ai_key()` SECURITY DEFINER RPCs, owner-only
RLS on all verbs (deliberately no `is_admin()` branch — tighter than every other table),
column-level grant excluding `key_ciphertext` from `authenticated`'s SELECT (read-side
access only via RPC).

**Phase 8c**: `supabase/migrations/20260724000011_project_management.sql` — no
`lib/types.ts`/domain shape change, no new table/column. The ONLY change is a
column-level grant tightening `authenticated`'s existing UPDATE privilege on
`projects` from every column to `name` only (`projects_update`/`projects_delete`
RLS, already admin-only since Phase 7a, are UNCHANGED — see "Project (client)
management (Phase 8c)" above for why this migration is smaller than an
earlier draft plan that considered loosening them).

**Phase 8d**: `supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql` — grant hygiene only, **applied to production 2026-07-22**. The `reports_delete` RLS policy already exists (Phase 7a), so report delete requires no schema changes. The one migration written is `revoke all on public.reports, public.tasks, public.risks, public.priorities from anon` — mirroring Phase 8c's identical hygiene fix for `projects`. Verified live (read-only): RLS is enabled on all four tables and every policy targets `authenticated` only, so `anon` has no policy and is **already denied everything** — these grants are latent cleanup, NOT a live vulnerability, and must not be described as one. Safe for the anon-reachable share/present path because `get_shared_report` is SECURITY DEFINER and runs as its owning role regardless of the caller's table grants.

**Post-apply verification (run against the hosted DB, read-only, immediately after applying)** — the same shape Phase 8c used for its `projects` revoke: `anon` now holds NO grants on any of the four tables; `authenticated` retains `DELETE` on all four (so report delete still works); `share_token` still has **no `SELECT`** for `authenticated`, i.e. Phase 7b's column-grant hardening survived the revoke untouched; and a REAL live share token still resolves through `get_shared_report` (2 tokens were live at the time) while a bogus token still returns null. The anonymous share/present path is therefore confirmed working after the revoke, not merely assumed to be.

**Task completion date**: `supabase/migrations/20260725000014_task_completed_at.sql`
— **written but NOT applied** (the user applies migrations themselves). Adds a
single nullable `tasks.completed_at date` (same `''` ↔ `NULL` convention as
`deadline`) plus a matching re-declaration of `replace_reports` (it inserts
`tasks` via an explicit column list, so the new column needed to be added there
too or it would silently never persist through the transactional write path).
See `docs/database-schema.md`'s "Task completion date" section for the full
story across every layer (Zod, db-mapping, CSV, MCP, the Schedule view).

**WP0 (role ladder)**: `supabase/migrations/20260726000015_role_ladder.sql` —
**written but NOT applied**. Two new functions (`public.role_rank`,
`public.has_role_at_least`), **no existing policy changed** — `is_admin()`
stays the enforcement function for every current admin-only policy. No
`lib/types.ts`/domain shape change; `lib/roles.ts` is the client mirror. See
"Role ladder and team directory (WP0 + WP1)" below.

**WP1 (team directory)**: `supabase/migrations/20260726000016_team_members.sql`
— **written but NOT applied**. One new table (`team_members`), RLS (select
open to all authenticated, insert/update/delete admin-only), and one new
SECURITY DEFINER RPC (`public.link_my_team_member()`, self-link only). New
domain shape (`lib/schema/team.ts`'s `TeamMemberSchema` → `lib/types.ts`'s
`TeamMember`/`TeamMemberRole`) landed alongside this migration, per this
section's own rule. See "Role ladder and team directory (WP0 + WP1)" below
and `docs/database-schema.md`'s matching section for the full story
(function grants, RLS, the account-linking design, and the full
repository/service/route/UI clone of the Project entity).

**WP2 (task assignee + creation date)**: `supabase/migrations/
20260726000017_task_assignee.sql` — **written but NOT applied**. Two new
nullable columns on `tasks` (`assignee_id` FK → `team_members`, `NO
ACTION`; `created_at date`), a matching index, and a re-declaration of
`replace_reports` (same reason `...014` needed one). **No RLS policy
touched** — WP3 owns any future policy change. New domain fields
(`TaskSchema`/`TaskInputSchema` gain `assigneeId`/`createdAt`) landed
alongside this migration, per this section's own rule. See "Task assignee
and creation date (WP2)" below and `docs/database-schema.md`'s matching
section for the full story (the FK/curatedMessage forward-declaration
payoff, the `createdAt` stamp-vs-omit design decision, and the full
Zod/mapping/UI/CSV/MCP story).

**WP3 (the access flip)**: `supabase/migrations/20260726000018_scoped_access.sql`
— **written AND verified live** (against a local Supabase stack,
`scripts/verify-access-matrix.ts`, 32/32 — NOT applied to any hosted/
production project, that remains the user's own call). Replaces
`reports_select`/`tasks_select`/`risks_select`/`priorities_select`'s
`using (true)` with owner-or-pm+-or-org-read-token scoping; drops the
`is_admin()` branch from every write policy on all four tables (editing is
now owner-ONLY); widens `reports_delete` from admin-only to pm-or-above;
widens the `reports_one_daily_per_day` unique index to also partition by
`owner_id`; adds `api_tokens.org_read` (admin-only at INSERT, enforced by
RLS) plus `public.token_has_org_read()` (a read-only-widening JWT-claim
predicate, isolated from `app_metadata`/`is_admin()`/`has_role_at_least()`
by construction); widens `verify_api_token` to also return `org_read`; and
adds two new SECURITY DEFINER RPCs, `public.list_assigned_tasks()`/
`public.update_assigned_task()`, the assignee's narrow read/write surface.
**No `lib/types.ts` domain shape changed** (`AssignedTask`/`AssignedTaskPatch`
are hand-written DTOs describing a bespoke RPC join result, not a stored
entity — see "Scoped access (WP3 — the access flip)" below for why that's
sound without a matching migration entry of its own beyond the RPCs
themselves, which this entry already covers).

**WP6 (My Week / My Day export)**: No schema change, no migration, no RLS
change, no `/api` change. The synthetic report `lib/my-week.ts` composes is
never persisted anywhere — there is no table row or Zod domain shape to add a
migration for. See "My Week / My Day export (WP6)" above.

## Layout

- `app/` — root layout (fonts, `ThemeProvider`, pre-hydration theme script),
  `(shell)/` route group (see "Routing").
- `styles/tokens/` — brand tokens, copied verbatim from `design-source/tokens/`.
  `styles/theme.css` / `theme-dark.css` — semantic-token light/dark values (see
  "Dark mode"). `print.css` — global rules for the presentation deck.
- `lib/` — `types` (z.infer facade, Phase 6a), `constants`, `format`, `report-utils`,
  `csv` (Phase 6b parsing + escaping), `csv-templates` (Phase 5 import contract),
  `prompts` (Phase 5 prompt library, locked MCP tool names, Phase 8a/7c house voice + polish fields),
  `seed` (7 weekly + 5 daily + 4 project + 3 team member seed records), `aggregate` (Phase 4 daily-into-draft,
  Phase 6b generalized), `view-utils`/`calendar` (Phase 3 derivation selectors), `project-view`
  (Phase 8c: `projectRollup`/`projectIsReferenced` derivation selectors), `import`
  (Phase 6b CSV importer), `consolidate` (Phase 6b consolidation logic), `projects` (Phase 6a
  project backfill; Phase 8c: `resolveNewProjectName`, shared by the CSV importer and the
  Settings Projects tab), `team` (WP1: `resolveNewTeamMemberName`, a deliberate near-copy of
  `projects`'s validator — see "Role ladder and team directory (WP0 + WP1)" above for why;
  WP2 adds `UNASSIGNED_VALUE`/`assigneeSelectOptions`/`assigneeSelectValue`/`resolveAssigneeId`,
  the Assignee `<Select>` helpers shared by `TaskDialog` and the wizard's `StepTasks`),
  `roles` (WP0: client-side role-ladder mirror — `Role`/`roleRank`/`hasRoleAtLeast`),
  `report-sections` (Phase 8d: per-kind section headings + grouping),
  `deck-slides` (Phase 8d: paginated deck builder + deterministic height estimation),
  `report-access` (Phase 8d: delete access predicate; WP3 adds `canEditReport`, owner-only, and
  widens `canDeleteReport` to `hasRoleAtLeast(user, 'pm')`), `task-merge` (WP4: `mergeTaskSources`/
  `groupMergedTasksByStatus`, the ONE shared merge of fully-loaded reports + the assignee bridge,
  reused by Home, `/tasks`, the Calendar's task lens, and `/my-week`), `task-calendar` (WP5: the
  Calendar task-lens date-bucketing selectors), `needs-attention` (Home's "Needs Attention"
  derivation over the shared merged set), `my-week` (WP6: `reportOverlapsRange`/`reportsInRange`/
  `assignedTaskOverlapsRange`/`filterReportsByScope`/`buildSyntheticReport` — see "My Week / My Day
  export (WP6)" above), `data/` (repository interface + localStorage impl + HTTP impl
  (Phase 7b) + factory; WP3 adds `getAssignedTasks`/`updateTask`), `hooks/useReports`, `hooks/useDailyReports` (Phase 4), `hooks/useProjects`
  (Phase 6a; Phase 8c adds `renameProject`/`deleteProject`), `hooks/useTeamMembers` (WP1: clones
  `useProjects` exactly), `hooks/useAssignedTasks` (WP3: the caller's own assigned tasks; wired into
  Home/`/tasks`/Calendar's merged set by WP4/WP5 and into `/my-week` by WP6), `schema/` (Zod 4, Phase 6a; WP1 adds `team.ts`; WP3 adds `AssignedTaskPatchSchema`
  to `api.ts`),
  `server/` (Phase 7b: `reports-service`, `db-mapping`, `route-helpers`, `request-guards`;
  Phase 8a: `mcp-auth`, `mcp-tools`; Phase 7c: `ai-crypto`, `ai-keys`, `ai-polish`; Phase 8c adds
  `renameProject`/`deleteProject` to `reports-service`; Phase 8d: `deleteReport` to `reports-service`;
  WP1 adds `listTeamMembers`/`ensureTeamMember`/`renameTeamMember`/`deleteTeamMember` to
  `reports-service` and a `TeamMemberRow`/mappers pair to `db-mapping`; WP2 adds
  `assignee_id`/`created_at` to `db-mapping`'s `TaskRow`/`mapTaskRow`/`reportToRow` and an
  `assignee_id` input field to `mcp-tools`'s `create_report`; WP3 adds `listAssignedTasks`/
  `updateAssignedTask` to `reports-service` and widens `mcp-auth`'s `verifyApiToken`/`mintMcpJwt`
  to carry the `org_read` scope), `supabase/` (Phase 7a: Supabase client
  factories including `anon.ts` for token-based present routes).
- `components/ui/` — design-system primitives (Button, StatCard, Table, Select,
  Input, Textarea, Checkbox, Switch, Badge, Dialog, Pagination, Tabs, Popover),
  plus `icons.tsx` (hand-authored SVG nav icons, Phase 5; `IconHome`/`IconChevron` Navigation IA restructure).
- `components/theme/` — `ThemeProvider`/`useTheme`.
- `components/app/` — `AppShell`, `Sidebar`, `PageHeader` (Phase 5, replaces
  per-screen brand headers), `MobileNav` (mobile P2, off-canvas drawer).
- `components/home/` — `HomePage` (orchestrator, Navigation IA restructure), `HomeScreen` (presentational,
  Navigation IA restructure; stat cards + recent reports table).
- `components/my-week/` — `MyWeekScreen` (WP6; `/my-week`, no-orchestrator pattern), `MyWeekPresentScreen`
  (WP6; `/my-week/present`, outside `(shell)`) — see "My Week / My Day export (WP6)" above.
- `components/dashboard|daily|wizard|dialogs/` — screens + route-level
  orchestration (`DashboardPage`, `DailyPage` (Phase 4), `WizardPage`, now
  `kind`-aware and, WP2, `useTeamMembers()`-aware) + `ShareDialog` (the only
  dialog left; Detail/Pdf dialogs were superseded by the report screen + real
  print flow, see "Report screen & presentation deck") +
  `ConfirmDeleteReportDialog` (Phase 8d: delete confirmation). `wizard/steps/
  StepTasks.tsx`'s `TaskRow` gained an Assignee `<Select>` (WP2).
- `components/report/` — `ReportScreen`, `ReportDeck`, `PresentScreen`
  (Phase 2; made interactive Phase 5; generalized to `AnyReport`/`kind` in
  Phase 4, see "Daily reports & the weekly import (Phase 4)").
- `components/tasks/` — `TaskViewScreen`, `TaskList`, `KanbanBoard`,
  `KanbanColumn`, `TaskCard`, `taskCardId` (Phase 3; see "Task and Calendar
  views"). `TaskDialog` gained an Assignee `<Select>` (WP2; `TaskViewScreen`
  now also calls `useTeamMembers()`).
- `components/calendar/` — `CalendarScreen`, `WeekGrid`, `MonthGrid`
  (Phase 3; see "Task and Calendar views").
- `components/consolidate/` — `ConsolidateScreen` (Phase 6b; now a 4-step wizard,
  Navigation IA restructure; consolidation UI).
- `components/projects/` — `ProjectsScreen` (list + create, still at `/projects`),
  `ProjectDetailScreen` (rename/delete, admin-gated; rollup, still at `/projects/[id]`),
  `ProjectsManager` (self-contained tab-based manager, Navigation IA restructure; Settings → Projects tab).
- `components/settings/` — `SettingsScreen` (Phase 5, now 5-tab layout Navigation IA restructure
  + WP1's Team tab; tab state + `?tab=` deep-linking), `ProjectsManager` (Navigation IA restructure;
  Projects tab), `CsvImportSection` (Phase 6b; Import tab), `McpAccessSection` (Phase 8a; Claude & AI
  tab), `AiKeySection` (Phase 7c; Claude & AI tab), `LocalDataImportSection` (Phase 7b; Import tab).
- `components/team/` — `TeamManager` (WP1: list/create/rename/delete the team directory,
  admin-gated; Settings → Team tab — see "Role ladder and team directory (WP0 + WP1)" above).
- `components/ai/` — `PolishButton` (Phase 7c; prose field rewrite button).
- `styles/print.css` — global print stylesheet for the presentation deck,
  imported only by `PresentScreen.tsx`.
- `scripts/verify-deck-print.ts` (Phase 8d): zero-dependency harness driving `chrome-headless-shell` over the DevTools Protocol. Spawns its own demo-mode dev server on a separate port + build dir, injects fixtures into `localStorage`, loads the present route, measures real PDF output via `/Count`, and asserts `buildDeckSlides(report).length === pageCount + 0 blank pages (no clipping under print emulation). Committed, CI-gated, 8 fixtures.
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
  neutral (prototype's `statusTone` returns an undefined tone). (The two
  dark-mode quirks previously listed here — "dark mode is partial by design"
  and "header/panel stays white in dark" — were intentionally superseded in
  Phase 1; see "Dark mode" above. "`saveDraft` always forces `Draft` status"
  was the third quirk listed here and was intentionally superseded in
  Phase 8d — see the `WizardPage` paragraph under "Routing" above — the same
  way the two dark-mode quirks were superseded rather than silently patched.)
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
