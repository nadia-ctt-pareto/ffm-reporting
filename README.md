# Weekly Reports Dashboard — Foundation First Marketing

Internal reporting tool for a boutique marketing agency. Project managers compose a structured weekly client report (or a daily report covering all clients) through a shared 6-step wizard, then browse and filter published reports on a dashboard/daily list. Started as a faithful Next.js/React port of a Claude Design prototype (kept in `design-source/`), now growing into a fuller internal app.

## Features

- **Sidebar app shell** with route-per-screen navigation and a collapsible sidebar.
- **Dashboard**: overview stats for the 7 weekly reports; filter by status/client/search; sort; **pagination** (page size 4 / 8 / 12 / All); export all tasks as CSV.
- **Daily Reports** (`/daily`): one report per day, covering all clients (not per-client) — a list (Date, Status, Tasks On Sched., Blockers, Updated, Continue/View), a Status filter, pagination, CSV export, and "New Daily Report". One daily per calendar date per project bucket is enforced (an inline wizard error on a duplicate date, plus a SQL partial unique index); bucket = a project (for imports) or "house" (for wizard-authored reports).
- **6-Step Report Wizard**, shared by both weekly (`/reports/new`, resume at `/reports/[id]/edit`) and daily (`/daily/new`, resume at `/daily/[id]/edit`) reports: Basics → Task Status → Touchpoints & Win → Risks & Blockers → Priorities → Review & Export. Basics is the only step that differs (a single Date field for daily vs. Week Start/End for weekly).
  - Per-step validation; Save Draft / Publish.
  - Import carry-forward panels on steps 2, 4, and 5 (re-use pending items from prior reports of the same kind).
  - **Weekly-only**: an "Import This Week's Daily Reports" panel on step 1 aggregates that week's daily reports into the draft — tasks/risks dedupe by client (keeping each one's latest status), touchpoints are summed, and the win carries over only if the draft doesn't already have one.
- **Report screen** (`/reports/[id]` and `/daily/[id]`): the full report, the working document with inline auto-save of status/prepared-for/period (week dates or a single date), read-only stats/tasks/risks/priorities display, and actions to open the presentation, copy the share link, or download a PDF.
- **Interactive HTML slide-deck presentation** (`/reports/[id]/present` and `/daily/[id]/present`): a 6-slide deck (Cover, Summary & Touchpoints, Task Status, Risks & Blockers, Priorities, The Win) with one slide visible at a time, powered by keyboard navigation (arrows, Space, Home/End, 1-6 digit shortcuts), a bottom overlay bar with Prev/Next buttons, dot indicators, slide counter, and fullscreen toggle. `?slide=N` deep-links jump to a slide. Touch/pen swipe support (mouse excluded for text selection). Fits to viewport on both axes, allowing scale > 1 for projectors. **All 6 slides stay mounted** — "one slide at a time" is pure CSS (`@media screen` hiding rule), so the print output is completely unaffected by which slide was active on screen; printing always outputs exactly 6 pages. No sidebar; share links open this interactive deck (true pre-Supabase share requires the recipient's browser to have that report in localStorage).
- **Task view** (`/tasks`): every WEEKLY report's tasks, in **List** mode (grouped by status: Blocked → In Progress → Complete, each row linking to its report) or **Kanban** mode (three drag-and-drop columns, powered by `@dnd-kit/core`; dragging a card to another column updates that task's status on its parent report and persists). A plain click on a Kanban card navigates to its report; dragging changes its status; keyboard drag (Space/arrows/Space) works too. (Daily-report tasks aren't surfaced here yet — documented follow-up, see CLAUDE.md.)
- **Calendar view** (`/calendar`): WEEKLY reports placed on a calendar by their `weekStart`/`weekEnd`, in **This Week** (a single Mon–Sun row) or **This Month** (a Monday-start, 6-row grid) mode, with Prev/Next/Today navigation. Weekly reports render as spanning bars; a month row with more reports than fit collapses the rest into a "+N more" popover. (Daily reports as single-day chips are a documented follow-up.)
- **Report consolidation** (`/consolidate`, Phase 6b): merge multiple weekly/daily reports touching a selected week, grouped by project bucket, with live preview, client-name normalization, and empty-row sanitization. "Create Consolidated Weekly Draft" creates a new working document for further editing in the wizard (no sources are modified or deleted).
- **CSV import** (Phase 6b): `/settings` upload interface with drag-drop, target project picker (existing / new / house), full-file issue accumulation (not abort-on-first), and formula-injection neutralization. `lib/csv-templates.ts` defines the locked column contract shared by both template builders and the importer.
- **Settings** (`/settings`): **Appearance** theme picker (Light / Dark / System preference that tracks OS); **Prompt Library** (copy-to-clipboard cards for future Claude connector); **CSV Import Templates** (downloadable examples with the exact column contract locked in `lib/csv-templates.ts`); **CSV Import** (upload with project targeting, drag-drop, full-file issue accumulation).
- **Projects** (Phase 6a): metadata entity (`id`, `name`) for grouping imported reports; optional on every task/risk/report. House reports (wizard-authored, no project) and imported reports (project-scoped) coexist under the same schema and enforcement rules.
- **Print-to-PDF**: "Download PDF" opens the presentation route and auto-triggers the browser's print dialog once fonts are ready; fixed 1280×720 slide pages print pixel-faithfully in Chrome/Edge (`@page` custom size + `print-color-adjust: exact` for the full-bleed black cover band and sage "Win" slide).
- **Dark mode**: a real, uniform theme (`data-theme` + semantic tokens) with 1:1 parity to light mode; Light / Dark / System preference with automatic OS tracking for System mode. Preference persists across reloads. The presentation deck itself always renders brand-light, regardless of the app's theme — it's the printed/shared artifact.
- **Data persistence**: all data lives in the browser's `localStorage` (per-browser; clear it to re-seed with 7 weekly + 5 daily sample reports + 4 projects). Share links resolve to an interactive presentation route, but persistence is per-browser — a shared link only works in a browser whose local storage already has that report. True cross-machine sharing arrives with Supabase (Phase 7+).

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
    settings/page.tsx              # /settings                 Settings (theme, prompts, CSV templates)
  reports/[id]/present/page.tsx    # /reports/:id/present      Interactive slide-deck route (no sidebar)
  daily/[id]/present/page.tsx      # /daily/:id/present        Interactive slide-deck route (no sidebar)

components/
  app/          AppShell.tsx, Sidebar.tsx, PageHeader.tsx           # navigation shell + shared route header
  theme/        ThemeProvider.tsx                                   # data-theme dark-mode source of truth
  dashboard/    DashboardPage.tsx (orchestration), DashboardScreen.tsx (presentational)
  daily/        DailyPage.tsx (orchestration), DailyListScreen.tsx (presentational)
  wizard/       WizardPage.tsx, WizardScreen.tsx (both kind-aware), WizardStepper.tsx, ImportPanel.tsx, steps/, useWizard.ts
  report/       ReportScreen.tsx, ReportDeck.tsx, PresentScreen.tsx (all generalized to AnyReport/kind)
  tasks/        TaskViewScreen.tsx, TaskList.tsx, KanbanBoard.tsx, KanbanColumn.tsx, TaskCard.tsx
  calendar/     CalendarScreen.tsx, WeekGrid.tsx, MonthGrid.tsx
  settings/     SettingsScreen.tsx                                  # theme picker, prompt library, CSV templates
  dialogs/      ShareDialog.tsx
  ui/           Button, StatCard, Table, Select, Input, Textarea, Checkbox, Switch, Badge, Dialog,
                Pagination, Tabs, Popover, icons.tsx               # design-system primitives + hand-authored SVG icons

lib/
  types.ts, constants.ts, format.ts, report-utils.ts, csv.ts, csv-templates.ts, prompts.ts, seed.ts
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
- **Dark mode** = `data-theme="dark"` on `<html>` + token overrides, managed by `ThemeProvider` and applied pre-hydration to avoid a flash. Three theme preferences: Light, Dark, and System (tracks OS `prefers-color-scheme`). The presentation deck (`ReportDeck`) is the one exception by design: it always renders brand-light, regardless of the app's theme, because it's the printed/shared artifact — its wrapper locally re-declares the semantic tokens it reads back to their light values.
- **Radix primitives** (`radix-ui`) power `Dialog`, `Select`, `Switch`, `Tabs`, `Popover`, and the sidebar tooltip — headless, fully styled by our own CSS. Note: `Select`'s `onChange` receives the value directly (`onChange(value)`), and `Switch`'s receives the next `checked` boolean.
- **Navigation icons** (`components/ui/icons.tsx`) are hand-authored inline SVGs, deliberately not `lucide-react` (which is stroke-based with round caps/joins, fighting the "square corners everywhere" rule). All icons use `currentColor`, are `aria-hidden`, and have 16×16 viewBox (rendered at 18×18). Stroke-based icons use `strokeLinecap="square"` + `strokeLinejoin="miter"` to stay on-brand.
- Square corners everywhere; only the wizard stepper circles use `--radius-pill`.
- **Drag and drop** (Task view's Kanban board) uses `@dnd-kit/core` + `@dnd-kit/utilities` — installed with zero peer-dependency issues against React 19/Next 15 (no `--legacy-peer-deps`, no `overrides`).

### Presentation deck & print-to-PDF

- `/reports/[id]/present` and `/daily/[id]/present` are bare routes (no sidebar) rendering an interactive `ReportDeck` component: one slide visible on screen at a time via keyboard (arrows/Space/Home/End/1-6), touch swipe (pen too; mouse excluded), bottom overlay bar (Prev/Next, dot indicators, counter, fullscreen toggle), and `?slide=N` deep-links. **All 6 slides stay permanently mounted** (never conditionally rendered) — "one slide at a time" is pure `@media screen`-scoped CSS hiding, so print output is completely unaffected by which slide was active on screen; printing always outputs exactly 6 pages. Two-axis fit-to-viewport scaling (allows scale > 1 for projectors).
- Fixed 1280×720 slide boxes + a custom `@page` size mean the printed page IS the slide (no scaling, no reflow): the on-screen deck and the "Save as PDF" output are pixel-identical **in Chromium (Chrome/Edge)**. Firefox/Safari ignore custom `@page` sizes and will letterbox/scale instead — export via Chrome or Edge for a pixel-perfect PDF (the present page's toolbar and README both document this).
- "Download PDF" (report screen and wizard publish-confirmation screen) opens the presentation route with `?print=1`, which auto-triggers the browser's print dialog once the report has loaded and fonts are ready.

### Known quirks (by design)

- "Final" status badge renders neutral (prototype's intended tone).
- `saveDraft` always forces status to "Draft", even when editing a published report.
- Share links resolve to a real route (`/reports/[id]/present`), but persistence is per-browser `localStorage` — a shared link only resolves in a browser whose local storage already has that report. True cross-machine sharing arrives with the Supabase cutover.
- Pixel-faithful PDF export only works in Chromium-based browsers (see above).

## Roadmap

**Now** (Phase 6 complete): everything local (`localStorage`), sidebar shell with SVG nav icons, real dark mode (Light / Dark / System), pagination, full report screen, interactive HTML slide-deck presentation (keyboard/swipe/deep-links), print-to-PDF, share links, Task view (List/Kanban) + Calendar view (Week/Month), daily reports (`/daily`) + weekly wizard roll-up, Settings screen with theme picker and prompt library, **Zod schemas** as the single source of truth, **Project entity** for organizing imported reports, **CSV import** with formula-injection safety and full-file issue accumulation, **report consolidation** (`/consolidate`) for merging reports by week.
**Next** (Phase 7): Supabase Auth (magic link) + per-user ownership; surface daily reports in Task view and Calendar (deliberately deferred). See CLAUDE.md "Roadmap" for Phase 7-9 plans.
**Later**: implement `SupabaseReportsRepository` against the versioned migrations (Phase 7+), deploy on Vercel (Phase 9).

Post-MVP usability/design backlog: `design-source/NEXT_STEPS.md`. Design rationale and conventions: `CLAUDE.md`.

## Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict).
- **Radix UI** headless primitives; **no** framework CSS (custom tokens + CSS Modules).
- Fonts: **Poppins** + **Open Sans** via `next/font/google`.
