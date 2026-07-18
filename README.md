# Weekly Reports Dashboard — Foundation First Marketing

Internal weekly-reporting tool for a boutique marketing agency. Project managers compose a structured weekly client report through a 6-step wizard, then browse and filter published reports on a dashboard. Started as a faithful Next.js/React port of a Claude Design prototype (kept in `design-source/`), now growing into a fuller internal app.

## Features

- **Sidebar app shell** with route-per-screen navigation and a collapsible sidebar.
- **Dashboard**: overview stats; filter by status/client/search; sort; **pagination** (page size 4 / 8 / 12 / All); export all tasks as CSV.
- **6-Step New Report Wizard** (`/reports/new`, resume at `/reports/[id]/edit`): Basics → Task Status → Touchpoints & Win → Risks & Blockers → Priorities → Review & Export.
  - Per-step validation; Save Draft / Publish.
  - Import carry-forward panels on steps 2, 4, and 5 (re-use pending items from prior reports).
- **Detail dialog**: inline auto-save of report fields (becomes a full report page in a later phase).
- **Dark mode**: a real, uniform theme (`data-theme` + semantic tokens) with 1:1 parity to light mode; preference persists across reloads.
- **Data persistence**: all data lives in the browser's `localStorage` (per-browser; clear it to re-seed with 7 sample reports).
- **Share & PDF** are mocked (UI-only) in the current phase — real slide-deck presentation, print-to-PDF, and share routes land in Phase 2.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first load, the app seeds `localStorage` with 7 sample reports (key: `ff.weekly-reports.v1`). To reset, clear your browser's local storage for this origin.

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
  layout.tsx                    # Root layout: fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                  # AppShell (sidebar + content) wrapping every in-app route
    page.tsx                    # /                    Dashboard
    reports/new/page.tsx        # /reports/new         Blank weekly wizard
    reports/[id]/edit/page.tsx  # /reports/:id/edit    Resume a draft

components/
  app/          AppShell.tsx, Sidebar.tsx           # navigation shell
  theme/        ThemeProvider.tsx                   # data-theme dark-mode source of truth
  dashboard/    DashboardPage.tsx (orchestration), DashboardScreen.tsx (presentational)
  wizard/       WizardPage.tsx, WizardScreen.tsx, WizardStepper.tsx, ImportPanel.tsx, steps/, useWizard.ts
  dialogs/      ReportDetailDialog.tsx, ShareDialog.tsx, PdfDialog.tsx
  ui/           Button, StatCard, Table, Select, Input, Textarea, Checkbox,
                Switch, Badge, Dialog, Pagination   # design-system primitives (Radix-backed where interactive)

lib/
  types.ts, constants.ts, format.ts, report-utils.ts, csv.ts, seed.ts
  data/         reports-repository.ts (interface), local-storage-reports-repository.ts, index.ts (factory)
  hooks/        useReports.ts

styles/
  tokens/*.css                  # Brand tokens (verbatim from design-source)
  theme.css, theme-dark.css     # Semantic-token light values + [data-theme='dark'] overrides
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

Data access is decoupled via the `ReportsRepository` interface (`lib/data/reports-repository.ts`). The **MVP** `LocalStorageReportsRepository` stores everything under the versioned key `ff.weekly-reports.v1` and auto-seeds 7 sample reports on first load.

**UI code must never import a concrete repository** — everything calls `getReportsRepository()` from `lib/data/index.ts`. That single factory is where a future Supabase/Postgres implementation slots in with **zero UI changes**. The Postgres schema is already versioned under `supabase/migrations/` (see `docs/database-schema.md`) so the cutover is fast, even though no repository reads it yet.

### Styling & theming

- **No Tailwind.** Brand CSS custom properties (`styles/tokens/*.css` + `styles/theme.css` / `styles/theme-dark.css`) + CSS Modules. Components read semantic tokens (`var(--surface-card)`, `var(--text-heading)`, …); there is no `darkMode ? {...} : {...}` inline branching.
- **Dark mode** = `data-theme="dark"` on `<html>` + token overrides, managed by `ThemeProvider` and applied pre-hydration to avoid a flash.
- **Radix primitives** (`radix-ui`) power `Dialog`, `Select`, `Switch`, and the sidebar tooltip — headless, fully styled by our own CSS. Note: `Select`'s `onChange` receives the value directly (`onChange(value)`), and `Switch`'s receives the next `checked` boolean.
- Square corners everywhere; only the wizard stepper circles use `--radius-pill`.

### Known quirks (by design)

- "Final" status badge renders neutral (prototype's intended tone).
- `saveDraft` always forces status to "Draft", even when editing a published report.
- Share links and PDF export are UI-only mocked dialogs in the current phase (real ones arrive in Phase 2).

## Roadmap

**Now**: everything local (`localStorage`), sidebar shell, real dark mode, pagination.
**Next phases**: full report page + branded HTML slide deck + print-to-PDF + share route (2); Task view (List/Kanban) + Calendar view (3); daily reports + roll-up into the weekly wizard (4).
**Later**: implement `SupabaseReportsRepository` against the versioned migrations, deploy on Vercel.

Post-MVP usability/design backlog: `design-source/NEXT_STEPS.md`. Design rationale and conventions: `CLAUDE.md`.

## Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict).
- **Radix UI** headless primitives; **no** framework CSS (custom tokens + CSS Modules).
- Fonts: **Poppins** + **Open Sans** via `next/font/google`.
