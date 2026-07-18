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
  Share links and PDF export are intentionally **mocked** (UI-only dialogs).
- **Later:** PostgreSQL via Supabase (implement `SupabaseReportsRepository`),
  deploy on Vercel, real share routes (`/r/[id]`) and real PDF generation.
- Post-MVP backlog lives in `design-source/NEXT_STEPS.md` — **out of scope now.**

## Routing

Real App Router routes, all inside the `(shell)` route group (a sidebar +
content grid shared by every route in Phase 1):

```
app/
  layout.tsx                          # html/body, fonts, ThemeProvider, pre-hydration theme script
  (shell)/
    layout.tsx                        # 'use client' -- <AppShell> (sidebar + main)
    page.tsx                          # /                      Dashboard
    reports/new/page.tsx              # /reports/new            Weekly wizard (blank)
    reports/[id]/edit/page.tsx        # /reports/:id/edit       Weekly wizard (resume draft)
```

Only these routes exist in Phase 1. `/tasks`, `/calendar`, `/reports/[id]`,
`/reports/[id]/present`, `/daily/*` are later phases — don't add nav items or
routes for them yet.

Route-level orchestration (filter/sort/pagination state, dialog hosting,
`useReports()` calls) lives in `components/dashboard/DashboardPage.tsx` and
`components/wizard/WizardPage.tsx`; `app/(shell)/**/page.tsx` files are thin
wrappers around those. `DashboardScreen`/`WizardScreen` stay presentational
(prop-driven), matching the pre-Phase-1 convention.

- `DashboardPage` owns filter/sort/search/pagination state locally — it
  resets on navigation away and back (acceptable; not persisted).
- `WizardPage` loads reports itself, resolves the initial draft
  (`structuredClone`'d from the matching report on `/reports/[id]/edit`,
  exactly like the old `resumeDraft`), and renders `<WizardScreen key={id}>`
  so a fresh "New Report" or "Continue" always remounts with clean internal
  state. An unknown `id` redirects to `/` — it never falls through to a
  blank wizard.
- The sidebar's Dark Mode switch lives in `components/app/Sidebar.tsx`
  (footer) — it was removed from the dashboard/wizard headers.

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
  (`DashboardPage`, `WizardPage`).
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

## Gates

```
npm run build && npm run lint && npm run typecheck
```

All three must exit 0 before review/commit. `npm run dev` for manual verification.
