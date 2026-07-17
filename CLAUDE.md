# Weekly Reports Dashboard — Foundation First Marketing

Internal weekly-reporting web app for a boutique marketing agency. Project managers
compose a structured weekly report (tasks, risks, touchpoints, a win, next-week
priorities) through a 6-step wizard, then browse/filter published reports on a
dashboard. Ported from a Claude Design prototype (`design-source/original-dashboard.dc.html`).

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript** (strict).
- **No Tailwind.** Styling = brand CSS custom properties (`styles/tokens/*.css`) +
  CSS Modules for UI primitives + ported inline-style objects for dynamic
  (dark-mode-dependent) screen layout.
- Fonts via `next/font/google`: **Poppins** (headings/UI) + **Open Sans** (body).
- Persistence: **swappable `ReportsRepository`**. MVP = `localStorage` impl
  (`lib/data/`). Future = Supabase/Postgres impl behind the same interface — the
  UI must never import a concrete repository, only `getReportsRepository()`.

## Roadmap

- **Now (MVP):** everything local. Data in `localStorage`, seeded with 7 reports.
  Share links and PDF export are intentionally **mocked** (UI-only dialogs).
- **Later:** PostgreSQL via Supabase (implement `SupabaseReportsRepository`),
  deploy on Vercel, real share routes (`/r/[id]`) and real PDF generation.
- Post-MVP backlog lives in `design-source/NEXT_STEPS.md` — **out of scope now.**

## Layout

- `app/` — layout (fonts, globals), `page.tsx` → `<WeeklyReportsApp/>`.
- `styles/tokens/` — brand tokens, copied verbatim from `design-source/tokens/`.
- `lib/` — `types`, `constants`, `format`, `report-utils`, `csv`, `seed` (the 7
  seed reports), `data/` (repository interface + localStorage impl + factory),
  `hooks/useReports`.
- `components/ui/` — design-system primitives (Button, StatCard, Table, Select,
  Input, Textarea, Checkbox, Switch, Badge, Dialog).
- `components/app|dashboard|wizard|dialogs/` — screens.
- `design-source/` — imported prototype + tokens + backlog (reference only; not shipped).

## Conventions

- **The prototype script block is the behavioral spec — port its logic faithfully,
  don't reinvent.** Line references live in the fable-advisor plan / PROGRESS log.
- Dates are **ISO strings**; compare with `localeCompare`, format via the manual
  parsers in `lib/format.ts`. No `Date`-based timezone math in comparisons.
- Use `var(--token)`; never restate brand hex values in components.
- Square corners everywhere (0 radius); the wizard stepper circles are the only
  exception (`--radius-pill`).
- Known faithful-port quirks (do not "fix" silently): "Final" status badge renders
  neutral (prototype's `statusTone` returns an undefined tone); dark mode is
  partial by design; `saveDraft` always forces `Draft` status.

## Gates

```
npm run build && npm run lint && npm run typecheck
```

All three must exit 0 before review/commit. `npm run dev` for manual verification.
