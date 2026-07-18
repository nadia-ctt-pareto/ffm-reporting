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

- **Now (MVP):** everything local. Data in `localStorage`, seeded with 7 reports.
  Share links resolve to a real, read-only branded slide-deck route
  (`/reports/[id]/present`); "PDF export" is the real browser print flow
  against that same route (no server-side rendering dependency).
- **Later:** PostgreSQL via Supabase (implement `SupabaseReportsRepository`),
  deploy on Vercel, true cross-machine share links (today's links only
  resolve in a browser whose localStorage already has the report).
- Post-MVP backlog lives in `design-source/NEXT_STEPS.md` — **out of scope now.**

## Routing

Real App Router routes. Every route lives inside the `(shell)` route group
(a sidebar + content grid) **except** `/reports/[id]/present`, which
deliberately sits outside it so only the root layout applies (no sidebar on
the bare, shareable slide-deck route):

```
app/
  layout.tsx                          # html/body, fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                        # 'use client' -- <AppShell> (sidebar + main)
    page.tsx                          # /                       Dashboard
    reports/new/page.tsx              # /reports/new             Weekly wizard (blank)
    reports/[id]/edit/page.tsx        # /reports/:id/edit        Weekly wizard (resume draft)
    reports/[id]/page.tsx             # /reports/:id             Report screen (Phase 2)
  reports/[id]/present/page.tsx       # /reports/:id/present     Bare slide-deck route (Phase 2, outside (shell))
```

`app/(shell)/reports/[id]/page.tsx` and `app/reports/[id]/present/page.tsx`
both contribute to the `reports/[id]/*` URL space from two different
physical trees (one inside the `(shell)` group, one outside it) but resolve
to distinct paths (`/reports/[id]` vs `/reports/[id]/present`) -- verified
in `next build`'s route table (the former is listed without a route-group
collision error, and only the latter is confirmed sidebar-free by
inspecting the rendered DOM). If a future route ever needs a genuinely
different `[id]` param name at the same segment depth, promote `present/`
into its own `(present)` route group instead of relying on this.

`/tasks`, `/calendar`, `/daily/*` are later phases — don't add nav items or
routes for them yet.

Route-level orchestration (filter/sort/pagination state, dialog hosting,
`useReports()` calls) lives in `components/dashboard/DashboardPage.tsx` and
`components/wizard/WizardPage.tsx`; `app/(shell)/**/page.tsx` files are thin
wrappers around those. `DashboardScreen`/`WizardScreen` stay presentational
(prop-driven), matching the pre-Phase-1 convention. `app/(shell)/reports/
[id]/page.tsx` breaks from that split on purpose (see "Report screen &
presentation deck" below) -- it's small enough (one param, one hook, no
dialog hosting) that a dedicated orchestrator would be pure ceremony.

- `DashboardPage` owns filter/sort/search/pagination state locally — it
  resets on navigation away and back (acceptable; not persisted). "View"
  navigates to `/reports/[id]` (a real route, not a dialog).
- `WizardPage` loads reports itself, resolves the initial draft
  (`structuredClone`'d from the matching report on `/reports/[id]/edit`,
  exactly like the old `resumeDraft`), and renders `<WizardScreen key={id}>`
  so a fresh "New Report" or "Continue" always remounts with clean internal
  state. An unknown `id` redirects to `/` — it never falls through to a
  blank wizard. The publish-confirmation screen's "Download PDF" opens
  `/reports/[id]/present?print=1` in a new tab (real print flow, not a
  dialog); "Copy Share Link" still goes through `ShareDialog`.
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

`components/ui/Dialog.tsx`, `Select.tsx`, and `Switch.tsx` are rebuilt on the
unified `radix-ui` package (`import { Dialog, Select, Switch, Tooltip,
VisuallyHidden } from 'radix-ui'`) — headless behavior, 100% styled by our
own CSS Modules (`className={styles.x}` on each Radix part). No peer-dep
issues were hit installing it against React 19 / Next 15.

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

## Migrations discipline

**Any PR that changes `lib/types.ts` domain shapes must add a
`supabase/migrations/*.sql` delta and update the mapping tables in
`docs/database-schema.md`.** The baseline schema
(`supabase/migrations/20260717000001_initial_schema.sql`) exists ahead of
the actual Supabase cutover specifically so this discipline starts now,
before there's a repository implementation to keep in sync.

## Layout

- `app/` — root layout (fonts, `ThemeProvider`, pre-hydration theme script),
  `(shell)/` route group (see "Routing").
- `styles/tokens/` — brand tokens, copied verbatim from `design-source/tokens/`.
  `styles/theme.css` / `theme-dark.css` — semantic-token light/dark values (see
  "Dark mode").
- `lib/` — `types`, `constants`, `format`, `report-utils`, `csv`, `seed` (the 7
  seed reports), `data/` (repository interface + localStorage impl + factory),
  `hooks/useReports`.
- `components/ui/` — design-system primitives (Button, StatCard, Table, Select,
  Input, Textarea, Checkbox, Switch, Badge, Dialog, Pagination).
- `components/theme/` — `ThemeProvider`/`useTheme`.
- `components/app/` — `AppShell`, `Sidebar`.
- `components/dashboard|wizard|dialogs/` — screens + route-level orchestration
  (`DashboardPage`, `WizardPage`) + `ShareDialog` (the only dialog left;
  Detail/Pdf dialogs were superseded by the report screen + real print flow,
  see "Report screen & presentation deck").
- `components/report/` — `ReportScreen`, `ReportDeck`, `PresentScreen`
  (Phase 2; see "Report screen & presentation deck").
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
