# Weekly Reports Dashboard — Foundation First Marketing

Internal weekly-reporting tool for a boutique marketing agency. Project managers compose a structured weekly client report through a 6-step wizard, then browse and filter published reports on a dashboard. This is a faithful Next.js/React port of a Claude Design prototype (kept in `design-source/`).

## Features

- **Dashboard**: overview stats, filter by status/client/search, sort reports, export all tasks as CSV, dark-mode toggle.
- **6-Step New Report Wizard**: Basics → Task Status → Touchpoints & Win → Risks & Blockers → Priorities → Review & Export.
  - Per-step validation and auto-save drafts.
  - Import carry-forward panels on steps 2, 4, and 5 (re-use pending items from prior reports).
  - Publish or save as draft.
- **Detail Dialog**: inline auto-save of report fields.
- **Share & Export** (mocked in MVP): UI-only dialogs for share links and PDF export.
- **Data Persistence**: all data lives in the browser's `localStorage` (per-browser; clear it to re-seed with 7 sample reports).

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. On first load, the app seeds `localStorage` with 7 sample reports (key: `ff.weekly-reports.v1`). To reset, clear your browser's local storage for this origin.

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
  layout.tsx                    # Root layout (fonts, globals)
  page.tsx                      # Entry point → <WeeklyReportsApp/>

components/
  ui/                           # Design-system primitives
    Button.tsx, StatCard.tsx, Table.tsx, Select.tsx, Input.tsx,
    Textarea.tsx, Checkbox.tsx, Switch.tsx, Badge.tsx, Dialog.tsx
  app/
    WeeklyReportsApp.tsx        # Main app shell
  dashboard/
    Dashboard.tsx               # Dashboard screen
  wizard/
    NewReportWizard.tsx         # 6-step form wizard
    Step*.tsx                   # Individual wizard steps
  dialogs/
    DetailDialog.tsx            # Inline report editor
    ShareDialog.tsx             # Mocked share-link dialog
    ExportDialog.tsx            # Mocked PDF export dialog

lib/
  types.ts                      # Report, Task, Risk, Priority types
  constants.ts                  # FF_CLIENTS and other constants
  format.ts                     # Date/time parsing, formatting
  report-utils.ts               # Business logic (task status rolls up, etc.)
  csv.ts                        # CSV export
  seed.ts                       # 7 sample reports (verbatim port of prototype)
  data/
    reports-repository.ts       # ReportsRepository interface
    local-storage-reports-repository.ts  # MVP localStorage impl
    index.ts                    # getReportsRepository() factory
  hooks/
    useReports.ts               # Custom hook for reports CRUD

styles/
  tokens/
    *.css                       # Brand tokens (colors, typography, spacing)
  globals.css                   # Global resets, dark mode

design-source/
  original-dashboard.dc.html    # Claude Design prototype (reference)
  tokens/                       # Original design tokens
  NEXT_STEPS.md                 # Post-MVP backlog
```

## Architecture

### Swappable Repository Pattern

Data access is decoupled via the `ReportsRepository` interface (`lib/data/reports-repository.ts`):

```typescript
export interface ReportsRepository {
  getAll(): Promise<Report[]>;
  getById(id: string): Promise<Report | null>;
  upsert(report: Report): Promise<Report>;
  update(id: string, patch: Partial<Report>): Promise<Report | null>;
}
```

**MVP**: `LocalStorageReportsRepository` stores everything in the browser's `localStorage` under the versioned key `ff.weekly-reports.v1`. On first load (key absent), it auto-seeds with 7 sample reports from `lib/seed.ts`.

**UI code must never import a concrete repository.** Instead, all components call `getReportsRepository()` from `lib/data/index.ts`. This single factory is where future Supabase/Postgres persistence slots in with **zero UI changes**.

### Styling

- No Tailwind. Styling uses CSS custom properties (brand tokens in `styles/tokens/`) + CSS Modules for UI primitives + dynamic inline-style objects (for dark-mode-dependent layouts).
- Fonts: **Poppins** (headings/UI) and **Open Sans** (body) via `next/font/google`.
- Square corners everywhere; only the wizard stepper circles use `--radius-pill`.

### Known MVP Quirks (by design)

- "Final" status badge renders neutral (prototype's intended tone).
- Dark mode is partial.
- Share links and PDF export are UI-only mocked dialogs (no real generation or hosting yet).
- `saveDraft` always forces status to "Draft", even if editing a published report.

## Roadmap

**Now (MVP)**: Everything local. Data in `localStorage`, seeded with 7 reports. Share/PDF dialogs are mocked (UI only).

**Later**: 
1. Implement `SupabaseReportsRepository` (same interface, real Postgres backend).
2. Deploy on Vercel.
3. Build real share routes (`/r/[id]`) and real PDF generation.

Post-MVP usability and design improvements are tracked in `design-source/NEXT_STEPS.md` (out of scope for MVP).

## Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict mode).
- **Fonts**: Poppins + Open Sans via `next/font/google`.
- **No framework CSS** — custom design tokens + CSS Modules + inline styles.

---

For design rationale and implementation notes, see `CLAUDE.md`.
