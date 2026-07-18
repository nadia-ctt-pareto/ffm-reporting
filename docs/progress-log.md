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

## 2026-07-17: Phase 2 (Report experience) — report screen, branded slide-deck presentation, real print-to-PDF, live share links

**Summary**: Replaced the report Detail modal with a full report screen at its own route (`/reports/[id]`), added a bare read-only branded HTML slide-deck presentation route (`/reports/[id]/present`, deliberately outside the `(shell)` route group so it never gets the sidebar), wired real browser print-to-PDF against that route, added a PDF-preview filmstrip on the report screen using the exact same deck component, and made "Copy Share Link" copy the real present-route URL. Deleted `ReportDetailDialog` and `PdfDialog` (superseded).

**What was built**:
- **Routes**: `app/(shell)/reports/[id]/page.tsx` (`/reports/[id]`, in-shell) and `app/reports/[id]/present/page.tsx` (`/reports/[id]/present`, bare — only the root layout applies). Both resolve to distinct paths despite sharing the `reports/[id]/*` URL space from two different physical trees; confirmed no route-group collision in `next build`'s route table, and confirmed via a rendered-DOM check that the present route has zero `<aside>` (sidebar) elements while the in-shell report route has exactly one.
- **`components/report/ReportScreen.tsx`**: the old `ReportDetailDialog` promoted to a route — same editable status/preparedFor/weekStart/weekEnd autosave (`updateReportFields`, "Changes save automatically."), same read-only stats/task-table/risks/priorities display, same `dSafe` null-guard (extended to the full `Report` shape since it now also feeds `ReportDeck`). Adds an actions row (Copy Share Link, Download PDF, Open Presentation) and a PDF-preview filmstrip (the real `ReportDeck`, scaled via `transform: scale(0.25)` inside an exactly-sized viewport). Owns its own small Share-dialog UI state directly rather than a separate route-level orchestrator (the route is small enough — one param, one hook — that a `ReportPage.tsx` would be pure ceremony).
- **`components/report/ReportDeck.tsx`**: the branded 6-slide deck (Cover with the diagonal band + hero win-stat in the serif display font; Summary + touchpoints StatCards; Task Status table; Risks & Blockers cards — first real usage of `riskTone`, previously defined but unused; Next Week's Priorities; The Win on a sage field). Rendered by both the report screen's preview filmstrip and the present route — one component guarantees preview/print parity. Always renders brand-light regardless of `data-theme`: its `.deck` wrapper locally re-declares every semantic token it (and the reused Badge/StatCard/Table primitives) reads, back to light-mode values. Exports `DECK_SLIDE_WIDTH`/`HEIGHT`/`COUNT`/`TOTAL_HEIGHT` as the single source of truth for both its own CSS (fed in as custom properties) and the preview/present pages' geometry math.
- **`components/report/PresentScreen.tsx`**: the present route's client component — a screen-only toolbar (Back to Report, Download PDF, a Chrome/Edge export hint), responsive on-screen fit-scaling (`ResizeObserver`), `?print=1` auto-print (`document.fonts.ready` → one `requestAnimationFrame` → `window.print()`), and a branded "Report Not Found" state for unknown ids. Reads `useSearchParams()`, wrapped in `<Suspense>` by its caller per Next.js's prerendering requirement.
- **`styles/print.css`**: global (non-CSS-Module) print stylesheet, imported only by the present route. Fixed `@page { size: 1280px 720px; margin: 0 }` + fixed `.slide` boxes means the printed page IS the slide. Every rule is `!important` — without it, a CSS-Module/global-stylesheet source-order fight silently left the toolbar visible and mis-sized the print stage, producing 7-8 PDF pages instead of 6 in testing.
- **`components/dialogs/ShareDialog.tsx`**: `shareLinkFor` now returns `${window.location.origin}/reports/${id}/present` (SSR-guarded); disclaimer copy updated to describe the real read-only presentation and the per-browser `localStorage` caveat instead of "isn't live yet".
- **`components/dashboard/DashboardPage.tsx`**: "View" now does `router.push('/reports/'+id)`; all Detail/Share/Pdf dialog hosting removed (Share now lives on the report screen itself).
- **`components/wizard/WizardPage.tsx`**: publish-confirmation's "Download PDF" now opens `/reports/[id]/present?print=1` in a new tab instead of the mocked `PdfDialog`; "Copy Share Link" still goes through `ShareDialog`.
- Deleted `components/dialogs/ReportDetailDialog.tsx`(+css) and `PdfDialog.tsx`(+css) — superseded, no dangling references.

**Quality**:
- All three gates (`npm run build`, `npm run lint`, `npm run typecheck`) pass.
- Manual verification via a scripted Playwright pass (dev server + a production `next build`/`next start`, chromium): dashboard "View" → `/reports/[id]`; edited Prepared For + refreshed → change persisted; dark-mode toggle confirmed the deck's cover slide stays `rgb(10,10,10)` (brand-black) regardless of `data-theme`; Copy Share Link produced the correct `…/reports/[id]/present` URL and copy-confirmation state; Open Presentation opened a new tab with exactly 6 `.slide` elements; unknown present-route id showed the branded not-found state; present route confirmed sidebar-free, report route confirmed sidebar-present; `?print=1` confirmed to call `window.print()`; full wizard publish flow confirmed the confirmation screen's Copy Share Link and Download PDF (opened `…/present?print=1` with 6 slides). Zero console errors/warnings across every flow.
- **Real print output verified, not just CSS inspected**: generated an actual PDF via Chromium's `page.pdf()` (print media emulated) against both the dev server and a production build, and parsed the PDF's own page tree (`/Count`) — confirmed exactly 6 pages (no trailing blank page), the cover slide's full-bleed black band and the Win slide's sage fill both survived rasterization (`print-color-adjust: exact`), and each `.slide`'s `break-after` resolved to `page` (`auto` on the last slide only). This caught and fixed a real bug: without `!important` on every `print.css` rule, a CSS-Module/global source-order flip left the toolbar visible in print and left a stale on-screen inline `height` in place, producing 7-8 pages instead of 6.
- `CLAUDE.md`, `README.md` updated: new routes, the report-screen/deck/present-route architecture, the print.css `!important` rationale, the Chromium-only pixel-faithful-export caveat, and the share-link per-browser-`localStorage` caveat superseding the old "mocked" quirk.

**Next milestone**: Phase 3 (out of scope here) — Task view (List/Kanban) + Calendar view.
