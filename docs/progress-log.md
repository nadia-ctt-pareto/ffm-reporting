# Progress Log — Weekly Reports Dashboard

## 2026-07-17: MVP scaffold — dashboard, 6-step wizard, dialogs, localStorage persistence

**Summary**: Imported the Claude Design prototype and ported it to Next.js 15 + React 19 + TypeScript behind a swappable `ReportsRepository` persistence layer.

**What was built**:
- Full-featured dashboard with stat cards, status/client/search filters, Sort By dropdown, reports table with status badges, View/Continue actions, empty state, and CSV export.
- 6-step new report wizard (Basics → Task Status → Touchpoints & Win → Risks & Blockers → Priorities → Review & Export) with per-step validation.
- Import carry-forward panels on wizard steps 2, 4, and 5 to re-use pending items from prior reports.
- Draft auto-save with Save Draft / Publish flows.
- Detail dialog for inline report editing.
- Mocked Share-Link and PDF-Export dialogs (UI-only, no backend yet).
- Dark-mode toggle.
- MVP persistence: 7 sample reports seeded into `localStorage` (key `ff.weekly-reports.v1`) on first load.

**Architecture**:
- `ReportsRepository` interface in `lib/data/reports-repository.ts` — swappable contract for all persistence.
- `LocalStorageReportsRepository` implements MVP with browser storage + auto-seeding.
- `getReportsRepository()` factory (`lib/data/index.ts`) is the single switch point; UI code never imports concrete repositories.
- No Tailwind — brand CSS custom properties + CSS Modules + dynamic inline styles for dark mode.

**Quality**:
- Built in two implementer passes with diff review.
- Fixed two nits during review: strict `resumeDraft` parity across steps, dialog focus trap and stacked-Escape handling.
- All gates pass: `npm run build`, `npm run lint`, `npm run typecheck`.
- E2E manual verification: dashboard navigation, full wizard publish flow, draft resume, all dialogs, persistence across page refresh, zero console warnings or hydration mismatches.

**Next milestone**: PostgreSQL via Supabase (implement `SupabaseReportsRepository` behind the same interface, deploy on Vercel, real share routes and PDF generation). Post-MVP backlog in `design-source/NEXT_STEPS.md`.

## 2026-07-17: Phase 1 (Foundation) — sidebar app shell, real routing, token-driven dark mode, Radix primitives, pagination, baseline schema

**Summary**: Refactored the single-page `WeeklyReportsApp` view-switcher into real App Router routes behind a sidebar app shell, replaced the scattered `darkMode ? {...} : {...}` inline-style branching with a token-driven dark theme (`data-theme` + semantic CSS custom properties), rebuilt `Dialog`/`Select`/`Switch` on Radix (`radix-ui`), added dashboard pagination, and authored the baseline Supabase schema + docs. Landed in three gate-green milestones (1a routing/shell, 1b dark mode/Radix, 1c pagination/migration/docs), each verified with `npm run build && npm run lint && npm run typecheck` plus a manual Playwright smoke pass.

**What was built**:
- **Routing (1a)**: `app/(shell)/layout.tsx` (`AppShell`: sidebar + content grid, collapse state persisted to `localStorage['ff.sidebar-collapsed']`), `app/(shell)/page.tsx` (`/`), `app/(shell)/reports/new/page.tsx`, `app/(shell)/reports/[id]/edit/page.tsx`. `WeeklyReportsApp.tsx` and the old `app/page.tsx` were deleted; their logic split into `components/dashboard/DashboardPage.tsx` and `components/wizard/WizardPage.tsx` (route-level orchestration, dialog hosting, `useReports()` per route). `Sidebar.tsx` hosts nav (Dashboard, active via `usePathname()`), the Dark Mode switch (moved out of the dashboard/wizard headers), and the collapse toggle, with a Radix `Tooltip` for collapsed-state nav labels.
- **Dark mode (1b)**: `components/theme/ThemeProvider.tsx` (context + `localStorage['ff.theme']` + mirrors `data-theme` onto `<html>`) plus a `next/script(beforeInteractive)` in `app/layout.tsx` for a no-FOUC pre-hydration flip. New `styles/theme.css` / `styles/theme-dark.css` centralize every semantic-token value the old inline `darkMode ? {...} : {...}` objects hardcoded. Every component that only took a `darkMode` prop for that branching (`DashboardScreen`, `WizardScreen`, `ImportPanel`, `StepTasks`, `StepRisks`, `StepPriorities`, `StatCard`) had it deleted; `rootStyle`/`filterBarStyle`/`lightPanelStyle`/`panelStyle` are gone. Fixed a real contrast bug caught during manual dark-mode review: several "solid black fill" chrome elements (`Button` `dark`/`outline`/`primary:hover`, `Badge` `dark`, the sidebar's active-nav chip and tooltip) would have gone invisible once `--surface-page` itself turned black — fixed by pairing `--text-heading`/`--surface-page` (always each theme's ink/paper pair) instead of literal `--ff-black`/`--ff-white`.
- **Radix (1b)**: `Dialog`/`Select`/`Switch` rebuilt on the unified `radix-ui` package, no peer-dep issues against React 19/Next 15. `Dialog` kept its exact API (Radix's dismiss-layer stack replaced the hand-rolled `dialogStack` module — nested Share-over-Detail dismisses top-first on a single Escape, verified). `Select`'s `onChange` is now `(value: string) => void` (Radix's `onValueChange`) — every call site updated (`DashboardScreen`, `ReportDetailDialog`, `ImportPanel`, `StepTasks`, `StepRisks`).
- **Pagination (1c)**: `components/ui/Pagination.tsx` (Prev/Next + "Page x of y") + a "Per Page" `Select` (`PAGE_SIZE_OPTIONS` = 4/8/12/All, default 8, `lib/constants.ts`). `DashboardScreen` slices after filter+sort; `DashboardPage` owns `page`/`pageSize` state and resets `page` to 1 on any filter/sort/size change (verified: switching to page size 4 shows "Page 1 of 2", Next advances, changing a filter resets to page 1).
- **Baseline schema (1c)**: `supabase/migrations/20260717000001_initial_schema.sql` (`clients`, `reports`, `tasks`, `risks`, `priorities`, indexes, RLS-enabled with stub `authenticated_full_access` policies) + `docs/database-schema.md` (full TS-field ↔ column mapping tables + cutover checklist). No repository code reads this schema yet — it's versioned ahead of the actual Supabase cutover.

**Quality**:
- All three gates (`npm run build`, `npm run lint`, `npm run typecheck`) passed after each of the three milestones.
- Manual verification via a scripted Playwright pass (dev server, chromium): dashboard load, dark-mode toggle + refresh persistence (no FOUC, `data-theme` correct before and after reload), navigation to `/reports/new` and back via Exit, Detail dialog open, Share dialog stacked on top of it, single-Escape-pops-top-dialog confirmed (2 dialogs → 1 → 0), sidebar collapse persisted to `localStorage`, unknown `/reports/:id/edit` id redirected to `/`, pagination slicing/reset confirmed. Zero console errors/warnings/hydration mismatches observed across the entire flow.
- `CLAUDE.md` updated: route map, dark-mode mechanism, Radix/Select API convention, migrations discipline, and the two dark-mode quirks explicitly marked superseded (kept the two still-true quirks: "Final" badge renders neutral, `saveDraft` forces `Draft`).

**Next milestone**: Phase 2 (out of scope here) — report detail page, task/calendar views, daily reports; see the plan's route-map note for what's deliberately not built yet.
