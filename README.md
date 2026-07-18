# Weekly Reports Dashboard — Foundation First Marketing

Internal reporting tool for a boutique marketing agency. Project managers compose a structured weekly client report (or a daily report covering all clients) through a shared 6-step wizard, then browse and filter published reports on a dashboard/daily list. Started as a faithful Next.js/React port of a Claude Design prototype (kept in `design-source/`), now growing into a fuller internal app.

## Features

- **Sidebar app shell** with route-per-screen navigation and a collapsible sidebar.
- **Dashboard**: overview stats for the 7 weekly reports; filter by status/client/search; sort; **pagination** (page size 4 / 8 / 12 / All); export all tasks as CSV.
- **Daily Reports** (`/daily`): one report per day, covering all clients (not per-client) — a list (Date, Status, Tasks On Sched., Blockers, Updated, Continue/View), a Status filter, pagination, CSV export, and "New Daily Report". One daily per calendar date is enforced (an inline wizard error on a duplicate date, plus a SQL partial unique index).
- **6-Step Report Wizard**, shared by both weekly (`/reports/new`, resume at `/reports/[id]/edit`) and daily (`/daily/new`, resume at `/daily/[id]/edit`) reports: Basics → Task Status → Touchpoints & Win → Risks & Blockers → Priorities → Review & Export. Basics is the only step that differs (a single Date field for daily vs. Week Start/End for weekly).
  - Per-step validation; Save Draft / Publish.
  - Import carry-forward panels on steps 2, 4, and 5 (re-use pending items from prior reports of the same kind).
  - **Weekly-only**: an "Import This Week's Daily Reports" panel on step 1 aggregates that week's daily reports into the draft — tasks/risks dedupe by client (keeping each one's latest status), touchpoints are summed, and the win carries over only if the draft doesn't already have one.
- **Report screen** (`/reports/[id]` and `/daily/[id]`): the full report, with inline auto-save of status/prepared-for/period (week dates or a single date), read-only stats/tasks/risks/priorities, a PDF-preview filmstrip, and actions to copy the share link, download a PDF, or open the full presentation.
- **Branded HTML slide-deck presentation** (`/reports/[id]/present` and `/daily/[id]/present`): a bare, read-only, 6-slide deck (Cover, Summary & Touchpoints, Task Status, Risks & Blockers, Priorities, The Win) — no sidebar, just the deck + a screen-only export toolbar. The exact same `ReportDeck` component powers both routes and the report screen's preview, so what you preview is what you export, for both report kinds.
- **Task view** (`/tasks`): every WEEKLY report's tasks, in **List** mode (grouped by status: Blocked → In Progress → Complete, each row linking to its report) or **Kanban** mode (three drag-and-drop columns, powered by `@dnd-kit/core`; dragging a card to another column updates that task's status on its parent report and persists). A plain click on a Kanban card navigates to its report; dragging changes its status; keyboard drag (Space/arrows/Space) works too. (Daily-report tasks aren't surfaced here yet — documented follow-up, see CLAUDE.md.)
- **Calendar view** (`/calendar`): WEEKLY reports placed on a calendar by their `weekStart`/`weekEnd`, in **This Week** (a single Mon–Sun row) or **This Month** (a Monday-start, 6-row grid) mode, with Prev/Next/Today navigation. Weekly reports render as spanning bars; a month row with more reports than fit collapses the rest into a "+N more" popover. (Daily reports as single-day chips are a documented follow-up.)
- **Print-to-PDF**: "Download PDF" opens the presentation route and auto-triggers the browser's print dialog once fonts are ready; fixed 1280×720 slide pages print pixel-faithfully in Chrome/Edge (`@page` custom size + `print-color-adjust: exact` for the full-bleed black cover band and sage "Win" slide).
- **Dark mode**: a real, uniform theme (`data-theme` + semantic tokens) with 1:1 parity to light mode; preference persists across reloads. The presentation deck itself always renders brand-light, regardless of the app's theme — it's the printed/shared artifact.
- **Data persistence**: all data lives in the browser's `localStorage` (per-browser; clear it to re-seed with 7 weekly + 5 daily sample reports). Share links only resolve in a browser whose local storage already has that report — true cross-machine sharing arrives with the Supabase cutover.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first load, the app seeds `localStorage` with 7 weekly + 5 daily sample reports (key: `ff.reports.v2`). To reset, clear your browser's local storage for this origin. If you have data from before Phase 4 (key `ff.weekly-reports.v1`), it's migrated to `ff.reports.v2` automatically on first load — the old `v1` key is left in place afterward as a backup, never deleted.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start local dev server (http://localhost:3000) |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint (must exit 0 before commit) |
| `npm run typecheck` | Run TypeScript compiler (must exit 0 before commit) |

All three gates (`build`, `lint`, `typecheck`) must pass before review.

## Project Structure

```
app/
  layout.tsx                       # Root layout: fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                     # AppShell (sidebar + content) wrapping every in-shell route
    page.tsx                       # /                        Dashboard (weeklies)
    reports/new/page.tsx           # /reports/new              Blank weekly wizard
    reports/[id]/edit/page.tsx     # /reports/:id/edit         Resume a weekly draft
    reports/[id]/page.tsx          # /reports/:id              Weekly report screen
    daily/page.tsx                 # /daily                    Daily report list
    daily/new/page.tsx             # /daily/new                Blank daily wizard
    daily/[id]/edit/page.tsx       # /daily/:id/edit           Resume a daily draft
    daily/[id]/page.tsx            # /daily/:id                Daily report screen
    tasks/page.tsx                 # /tasks                    Task view (List/Kanban, weeklies)
    calendar/page.tsx              # /calendar                 Calendar view (Week/Month, weeklies)
  reports/[id]/present/page.tsx    # /reports/:id/present      Bare weekly slide-deck route (no sidebar)
  daily/[id]/present/page.tsx      # /daily/:id/present        Bare daily slide-deck route (no sidebar)

components/
  app/          AppShell.tsx, Sidebar.tsx           # navigation shell
  theme/        ThemeProvider.tsx                   # data-theme dark-mode source of truth
  dashboard/    DashboardPage.tsx (orchestration), DashboardScreen.tsx (presentational)
  daily/        DailyPage.tsx (orchestration), DailyListScreen.tsx (presentational)
  wizard/       WizardPage.tsx, WizardScreen.tsx (both kind-aware), WizardStepper.tsx, ImportPanel.tsx, steps/, useWizard.ts
  report/       ReportScreen.tsx, ReportDeck.tsx, PresentScreen.tsx (all generalized to AnyReport/kind)
  tasks/        TaskViewScreen.tsx, TaskList.tsx, KanbanBoard.tsx, KanbanColumn.tsx, TaskCard.tsx
  calendar/     CalendarScreen.tsx, WeekGrid.tsx, MonthGrid.tsx
  dialogs/      ShareDialog.tsx
  ui/           Button, StatCard, Table, Select, Input, Textarea, Checkbox,
                Switch, Badge, Dialog, Pagination, Tabs, Popover   # design-system primitives (Radix-backed where interactive)

lib/
  types.ts, constants.ts, format.ts, report-utils.ts, csv.ts, seed.ts
  aggregate.ts  # daily-reports-into-weekly-draft rollup (pure)
  view-utils.ts, calendar.ts   # Phase 3 derivation selectors (pure, no new storage)
  data/         reports-repository.ts (interface), local-storage-reports-repository.ts, index.ts (factory)
  hooks/        useReports.ts, useDailyReports.ts

styles/
  tokens/*.css                  # Brand tokens (verbatim from design-source)
  theme.css, theme-dark.css     # Semantic-token light values + [data-theme='dark'] overrides
  print.css                     # Global print rules for the presentation deck (present route only)
  (globals.css lives in app/)

supabase/
  migrations/*.sql              # Versioned Postgres schema for the future Supabase cutover

docs/
  database-schema.md            # Schema + TS↔SQL field mapping + cutover checklist
  progress-log.md               # Dated build log

design-source/                  # Claude Design prototype + tokens + NEXT_STEPS backlog (reference)
```

## Architecture

### Swappable repository pattern

Data access is decoupled via the `ReportsRepository` interface (`lib/data/reports-repository.ts`). The **MVP** `LocalStorageReportsRepository` stores everything (both weekly and daily reports, discriminated by `kind`) under one versioned key, `ff.reports.v2`, and auto-seeds 7 weekly + 5 daily sample reports on first load. A pre-Phase-4 `ff.weekly-reports.v1` payload (weeklies only, no `kind` field) is migrated to `ff.reports.v2` automatically on first read — the `v1` key is kept in place afterward, forever, purely as a backup (see CLAUDE.md "Daily reports & the weekly import (Phase 4)" for the full migration-safety rationale).

**UI code must never import a concrete repository** — everything calls `getReportsRepository()` from `lib/data/index.ts`. That single factory is where a future Supabase/Postgres implementation slots in with **zero UI changes**. The Postgres schema is already versioned under `supabase/migrations/` (see `docs/database-schema.md`) so the cutover is fast, even though no repository reads it yet.

### Styling & theming

- **No Tailwind.** Brand CSS custom properties (`styles/tokens/*.css` + `styles/theme.css` / `styles/theme-dark.css`) + CSS Modules. Components read semantic tokens (`var(--surface-card)`, `var(--text-heading)`, …); there is no `darkMode ? {...} : {...}` inline branching.
- **Dark mode** = `data-theme="dark"` on `<html>` + token overrides, managed by `ThemeProvider` and applied pre-hydration to avoid a flash. The presentation deck (`ReportDeck`) is the one exception by design: it always renders brand-light, regardless of the app's theme, because it's the printed/shared artifact — its wrapper locally re-declares the semantic tokens it reads back to their light values.
- **Radix primitives** (`radix-ui`) power `Dialog`, `Select`, `Switch`, `Tabs`, `Popover`, and the sidebar tooltip — headless, fully styled by our own CSS. Note: `Select`'s `onChange` receives the value directly (`onChange(value)`), and `Switch`'s receives the next `checked` boolean.
- Square corners everywhere; only the wizard stepper circles use `--radius-pill`.
- **Drag and drop** (Task view's Kanban board) uses `@dnd-kit/core` + `@dnd-kit/utilities` — installed with zero peer-dependency issues against React 19/Next 15 (no `--legacy-peer-deps`, no `overrides`).

### Presentation deck & print-to-PDF

- `/reports/[id]/present` is a bare route (no sidebar) rendering the same `ReportDeck` component used by the report screen's PDF-preview filmstrip — one component, so the preview and the exported PDF can never drift apart.
- Fixed 1280×720 slide boxes + a custom `@page` size mean the printed page IS the slide (no scaling, no reflow): the on-screen deck and the "Save as PDF" output are pixel-identical **in Chromium (Chrome/Edge)**. Firefox/Safari ignore custom `@page` sizes and will letterbox/scale instead — export via Chrome or Edge for a pixel-perfect PDF (the present page's toolbar says so too).
- "Download PDF" (report screen and wizard publish-confirmation screen) opens the presentation route with `?print=1`, which auto-triggers the browser's print dialog once the report has loaded and fonts are ready.

### Known quirks (by design)

- "Final" status badge renders neutral (prototype's intended tone).
- `saveDraft` always forces status to "Draft", even when editing a published report.
- Share links resolve to a real route (`/reports/[id]/present`), but persistence is per-browser `localStorage` — a shared link only resolves in a browser whose local storage already has that report. True cross-machine sharing arrives with the Supabase cutover.
- Pixel-faithful PDF export only works in Chromium-based browsers (see above).

## Roadmap

**Now**: everything local (`localStorage`), sidebar shell, real dark mode, pagination, full report screen, branded HTML slide-deck presentation, print-to-PDF, share links, Task view (List/Kanban) + Calendar view (Week/Month), daily reports (`/daily`) + weekly wizard roll-up.
**Next**: surface daily reports in the Task view and Calendar (deliberately deferred out of Phase 4, see CLAUDE.md).
**Later**: implement `SupabaseReportsRepository` against the versioned migrations, deploy on Vercel, true cross-machine share links.

Post-MVP usability/design backlog: `design-source/NEXT_STEPS.md`. Design rationale and conventions: `CLAUDE.md`.

## Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict).
- **Radix UI** headless primitives; **no** framework CSS (custom tokens + CSS Modules).
- Fonts: **Poppins** + **Open Sans** via `next/font/google`.
