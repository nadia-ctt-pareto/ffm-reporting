# Database Schema — Weekly Reports Dashboard

Baseline schema for the eventual `SupabaseReportsRepository` (see
`lib/data/reports-repository.ts`). **No repository code reads/writes this
schema yet (that's Phase 7b)** — MVP persistence is still
`LocalStorageReportsRepository`. This document exists so the shape is
reviewed and versioned ahead of the cutover. The migration itself lives at
`supabase/migrations/20260717000001_initial_schema.sql`, with a Phase 4
delta at `supabase/migrations/20260717000002_daily_reports.sql`, a
Phase 6a delta (the Project entity) at
`supabase/migrations/20260718000003_projects.sql`, and a Phase 7a delta
(auth, ownership, real RLS, per-report share tokens, the transactional
import RPC, and the `created_at`/`updated_at` type widening) at
`supabase/migrations/20260719000004_auth_ownership.sql` — see "Auth,
ownership, and RLS (Phase 7a)" below.

## Discriminated union ↔ single table (Phase 4)

`lib/types.ts` models a report as a discriminated union:

```ts
type AnyReport = WeeklyReport | DailyReport; // kind: 'weekly' | 'daily'
```

Both variants share every field except their period (`weekStart`/`weekEnd`
vs. a single `date`) — see `ReportCore` in `lib/types.ts`. The schema mirrors
this as **one `reports` table**, not two: a `kind` discriminant column plus
a `reports_period_by_kind` CHECK constraint that enforces "exactly the
period columns matching `kind` are set, the other pair is NULL" (mirroring
the TS union's exhaustiveness — a row can never be both/neither). `tasks`,
`risks`, and `priorities` already FK to `reports(id)` and are byte-identical
in shape for both kinds, so splitting into a second `daily_reports` table
would only duplicate every child-table FK and every read/write query path
for no benefit.

**One daily report per day, PER PROJECT BUCKET** (Phase 6a; was "per day,
globally" pre-Phase-6a) is enforced at the SQL layer by a partial
*expression* unique index,
`reports_one_daily_per_day on reports (coalesce(project_id, ''),
report_date) where kind = 'daily'` (see
`supabase/migrations/20260718000003_projects.sql`) — weekly rows'
`report_date` is always NULL (per the CHECK constraint above), so they never
participate in that uniqueness check. A "bucket" is a project (`project_id`
set, for imported dailies, Phase 6b) or "house" (`project_id` NULL, every
report authored directly through the wizard) — two dailies only collide if
they share BOTH a date AND a bucket. **This is deliberately NOT a plain
`(project_id, report_date)` unique index**: Postgres treats NULLs as
distinct in uniqueness checks, so a plain index would never catch two house
dailies (both `project_id IS NULL`) sharing a date — `coalesce(project_id,
'')` folds every house daily into the same non-NULL bucket key so the
constraint is actually enforced for it too. The app enforces the identical
rule at THREE sites, all using `sameProjectBucket()` (the TS mirror of this
`coalesce` expression, `lib/report-utils.ts`): (1) wizard validation via
`dailyDateConflict()`/`validateStep()` (step 1, `saveDraft()`, `publish()`),
(2) daily report screen's inline date-field autosave via `invalidDailyDateEdit()`,
and (3) Phase 6b's CSV importer (`lib/import.ts`), which checks the constraint
both within the import file and against existing storage. A collision surfaces
as an inline error before constraint-violation instead of a raw DB error. A
wizard-created draft always has `projectId` unset (house bucket), so this
scoping is a no-op behavior change for every pre-Phase-6a flow.

## Design decisions

- **Text ids, not `uuid`.** Existing localStorage data (`lib/seed.ts`, and
  anything already persisted in a browser under `ff.reports.v2` — or, pre-
  Phase-4, `ff.weekly-reports.v1`) uses ids like `"r1"`/`"d1"` and
  `"t_abc123_4"` (see `lib/format.ts` `uid()`). Keeping every primary key as
  `text` lets that JSON import verbatim at cutover — zero id remapping.
- **`tasks.client` / `risks.client` stay the denormalized display string;
  `project_id` (Phase 6a) is the optional FK.** The wizard still edits
  `client` via a plain `Input` (`components/wizard/steps/StepTasks.tsx`,
  `StepRisks.tsx`, now with datalist autocomplete suggestions sourced from
  `projects`), not a `Select` bound to a project list -- free text remains
  the source of truth for display and every dedupe predicate (carry-forward
  Import panels, `aggregateDailiesIntoDraft`, CSV export) unchanged.
  `project_id` is pure metadata layered on top, stamped by an exact-name
  backfill (`lib/projects.ts` `ensureProjectIds()` app-side; the mirrored
  `update ... from projects where p.name = t.client` in
  `supabase/migrations/20260718000003_projects.sql` SQL-side) -- never
  fuzzy-matched, never auto-creates a project from a typo'd client string.
  This retires the pre-Phase-6a `TODO(cutover)` that proposed tightening
  `client` itself into a hard FK; `client` intentionally stays free text so
  it always renders even for a project-less (house) report.
- **Win/Touchpoints are columns, not join tables.** `Report['win']` and
  `Report['touchpoints']` are 1:1 with a report in the TS model, so they're
  flattened onto `reports` as `win_*` / `touchpoint_*` columns.
- **`tasks` / `risks` / `priorities` carry a `position` column.** They're
  ordered arrays in the TS model (`Report['tasks'][]`, etc.); `position`
  preserves that order on read-back.
- **RLS is real as of Phase 7a, not scoped by row ownership until Phase 7b
  wires a repository to it.** The pre-Phase-7a `authenticated_full_access`
  stub (`for all to authenticated using (true) with check (true)`) is gone
  — every table now has real per-operation policies keyed on `owner_id`
  (reports) or the parent report's `owner_id` (tasks/risks/priorities), plus
  an `is_admin()` bypass. See "Auth, ownership, and RLS (Phase 7a)" below.

## Field mapping: `reports`

`WeeklyReport` and `DailyReport` (Phase 4) share one table — see
"Discriminated union ↔ single table" above. `kind`/`report_date` are new in
`supabase/migrations/20260717000002_daily_reports.sql`; every other column
below predates Phase 4 and is unchanged.

| TS field (`AnyReport`)      | Column                    | Type      | Notes                                    |
| ---------------------------- | ------------------------- | --------- | ----------------------------------------- |
| `id`                         | `id`                      | `text` PK |                                            |
| `kind`                       | `kind`                    | `text`    | `check in ('weekly','daily')`, default `'weekly'`; see `reports_period_by_kind` |
| `weekStart` (weekly only)    | `week_start`               | `date`    | nullable (NULL for `kind = 'daily'`)      |
| `weekEnd` (weekly only)      | `week_end`                 | `date`    | nullable (NULL for `kind = 'daily'`); indexed `(kind, week_end desc)` |
| `date` (daily only)          | `report_date`              | `date`    | nullable (NULL for `kind = 'weekly'`); unique where `kind = 'daily'` (`reports_one_daily_per_day`); indexed `(kind, report_date desc)` |
| `status`                     | `status`                   | `text`    | `check in ('Draft','Final','Sent')`       |
| `preparedFor`                | `prepared_for`             | `text`    |                                            |
| `preparedBy`                 | `prepared_by`              | `text`    |                                            |
| `summaryNarrative`           | `summary_narrative`        | `text`    | default `''`                              |
| `win.stat`                   | `win_stat`                 | `text`    | default `''`                              |
| `win.label`                  | `win_label`                | `text`    | default `''`                              |
| `win.narrative`               | `win_narrative`             | `text`    | default `''`                              |
| `touchpoints.calls`          | `touchpoint_calls`         | `integer` | default `0`                               |
| `touchpoints.emails`         | `touchpoint_emails`        | `integer` | default `0`                               |
| `touchpoints.escalations`    | `touchpoint_escalations`   | `integer` | default `0`                               |
| `touchpoints.narrative`      | `touchpoints_narrative`    | `text`    | default `''`                              |
| `createdAt`                  | `created_at`                | `timestamptz` | Phase 7a: widened from `date` (see "created_at / updated_at" below); default `now()` |
| `updatedAt`                  | `updated_at`                | `timestamptz` | Phase 7a: widened from `date`, same note; default `now()` |
| `projectId`                  | `project_id`                | `text`, nullable | Phase 6a. FK → `projects(id)`. NULL = house-authored, multi-client report; set only for reports imported into a specific project (Phase 6b). Part of the daily-uniqueness bucket key -- see "One daily report per day, PER PROJECT BUCKET" above. |
| `ownerId`                    | `owner_id`                   | `uuid`, nullable | Phase 7a. FK → `auth.users(id)`. NULL = system/unclaimed (admin-editable only). See "Auth, ownership, and RLS (Phase 7a)" below. |
| `shareToken`                 | `share_token`                | `text`, nullable, `unique` | Phase 7a. Opt-in public share token, NULL by default. Server-generated only, never client-supplied. See "Per-report share tokens (Phase 7a)" below. |
| `tasks`                      | *(joined from `tasks`)*     | —         | `where report_id = reports.id order by position` |
| `risks`                      | *(joined from `risks`)*     | —         | `where report_id = reports.id order by position` |
| `priorities`                 | *(joined from `priorities`)*| —         | `where report_id = reports.id order by position` |

## Field mapping: `tasks`

| TS field (`Task`) | Column      | Type      | Notes                                             |
| ------------------ | ----------- | --------- | -------------------------------------------------- |
| `id`                | `id`        | `text` PK |                                                     |
| —                   | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`             |
| `client`            | `client`    | `text`    | free text (see design decisions) -- the display/dedupe string |
| `projectId`         | `project_id`| `text`, nullable | Phase 6a. FK → `projects(id)`. Pure metadata, stamped by exact-name backfill (see design decisions) -- does not replace `client`. |
| `task`              | `task`      | `text`    |                                                     |
| `status`            | `status`    | `text`    | `check in ('Complete','In Progress','Blocked')`     |
| `deadline`          | `deadline`  | `date`    | nullable — `''` ↔ `NULL`                            |
| —                   | `position`  | `integer` | preserves array order                               |

## Field mapping: `risks`

| TS field (`Risk`) | Column       | Type      | Notes                                         |
| ------------------ | ------------ | --------- | ----------------------------------------------- |
| `id`                | `id`         | `text` PK |                                                 |
| —                   | `report_id`  | `text`    | FK → `reports(id)`, `on delete cascade`         |
| `client`            | `client`     | `text`    | free text (see design decisions) -- the display/dedupe string |
| `projectId`         | `project_id` | `text`, nullable | Phase 6a. FK → `projects(id)`. See `tasks.project_id` above. |
| `severity`          | `severity`   | `text`    | `check in ('Blocked','At Risk')`                |
| `description`       | `description`| `text`    |                                                 |
| `nextStep`          | `next_step`  | `text`    | default `''`                                    |
| —                   | `position`   | `integer` | preserves array order                           |

## Field mapping: `priorities`

| TS field (`Priority`) | Column      | Type      | Notes                                     |
| ----------------------- | ----------- | --------- | ------------------------------------------ |
| `id`                     | `id`        | `text` PK |                                            |
| —                        | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`    |
| `text`                   | `text`      | `text`    |                                            |
| —                        | `position`  | `integer` | preserves array order                      |

## Field mapping: `projects`

Phase 6a: `projects` is a real TS entity now (`Project { id, name }`,
`lib/types.ts` via `lib/schema/project.ts`'s `ProjectSchema`), not just a
reference table -- renamed from `clients` in
`supabase/migrations/20260718000003_projects.sql` (`client = project`).
Seeded from `lib/seed.ts`'s `seedProjects()`, which hardcodes the same four
slug/name pairs the SQL `insert` uses verbatim (not derived via
`slugifyProjectName()`, so the two seeds can never drift apart).
`lib/constants.ts`'s `FF_CLIENTS` remains the client-name source for
`seedReports()`/`seedDailyReports()` (the ~50 task/risk `client` strings) --
it is NOT `seedProjects()`'s source; the project seed is an independent
verbatim copy, deliberately not derived from `FF_CLIENTS`.

| TS field (`Project`) | Column | Type              | Notes                                  |
| ---------------------- | ------ | ----------------- | --------------------------------------- |
| `id`                    | `id`   | `text` PK          | slug (e.g. `helitech-foundation-waterproofing`) |
| `name`                  | `name` | `text`, `unique`   | exact display string used throughout the UI |

## Auth, ownership, and RLS (Phase 7a)

`supabase/migrations/20260719000004_auth_ownership.sql` is the first
migration to actually wire Supabase Auth: it stamps `reports.owner_id` (`uuid`,
FK → `auth.users(id)`, nullable — NULL means system/unclaimed, admin-editable
only) and replaces every table's pre-7a `authenticated_full_access` stub
policy with real per-operation policies:

- **`reports`**: any authenticated user may `select`; `insert`/`update`/
  `delete` require `owner_id = auth.uid()` OR `is_admin()`. The `update`
  policy's `with check` re-validates the SAME predicate against the
  post-update row, which is what stops a non-admin from reassigning a
  report's `owner_id` to someone else — the new `owner_id` must still equal
  their own uid (or they must be an admin) or the whole update is rejected.
- **`tasks` / `risks` / `priorities`**: identical trio — `select` is open to
  any authenticated user; `insert`/`update`/`delete` require an `exists`
  subquery against the PARENT report's `owner_id`/`is_admin()` (a task/risk/
  priority has no owner of its own — it inherits its report's).
- **`projects`**: shared reference data. Any authenticated user may
  `select`/`insert` (creating a new project is not owner-gated — projects
  aren't owned); `update`/`delete` (renaming/removing one) are admin-only.
- **`public.is_admin()`** (`language sql stable`) reads
  `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`. `app_metadata` is
  server-set only (`auth.admin.updateUserById`, never user-editable like
  `user_metadata`), so it's safe to trust inside an RLS policy; a role change
  takes effect on the user's next token refresh (≤ 1h).
- **`(select auth.uid())`** is used throughout (not bare `auth.uid()`) — the
  Postgres-recommended "initplan" idiom that evaluates the function once per
  query rather than once per row.

No repository reads/writes any of this yet (that's Phase 7b) — this
migration only lands the SQL surface Phase 7b's `HttpReportsRepository`,
route handlers, and `lib/server/reports-service.ts` will consume against.

### Function EXECUTE grants: verify `pg_proc.proacl`, never the `revoke` statement's intent alone

**`revoke all on function f() from public` does NOT close a function to
`anon`/`authenticated`.** Supabase's baseline `alter default privileges in
schema public grant execute on functions to anon, authenticated,
service_role` (in `roles.sql`, applied before any migration in this repo
ever runs) grants EXECUTE to those three roles, individually, on every new
function created in this schema — `PUBLIC` is a separate pseudo-role from
`anon`/`authenticated`, and revoking from it does not touch an explicit
per-role grant. Verified exploitable before this was caught: `POST
/rest/v1/rpc/before_user_created_hook -d
'{"event":{"user":{"email":"x@gmail.com"}}}'`, called by a fully
unauthenticated, anonymous client, returned the function's real rejection
message — meaning anyone could enumerate the entire domain allowlist
without ever attempting a real signup (no rate limit, no audit trail, and
the function was never meant to be reachable this way at all — it's a
Postgres Auth Hook, invoked internally by GoTrue as `supabase_auth_admin`).

Every function this migration defines now has an explicit, audited grant —
name the roles that need it, revoke from every role that doesn't, and
**check `pg_proc.proacl` afterward** (not just re-read the `revoke`
statement) to confirm:

| Function | Reachable by | Rationale |
|---|---|---|
| `is_admin()` | `authenticated` only | Every policy that calls it is itself scoped `to authenticated`; `anon` has no legitimate reason to call it directly. |
| `get_shared_report(text)` | `anon`, `authenticated` | The whole point (Decision 1) — must be anon-reachable. |
| `replace_reports(jsonb, boolean)` | `authenticated` only | RLS already blocks an `anon` call (verified: `42501`), but `anon` has no legitimate reason to reach it at all — defense in depth, not the only gate. |
| `enable_report_share(text)` / `revoke_report_share(text)` | `authenticated` only | Owner-or-admin-gated internally; `anon` has no account to own a report with. |
| `before_user_created_hook(jsonb)` | `supabase_auth_admin` only | The auth hook oracle above — must NOT be reachable via `/rest/v1/rpc/*` by anyone, including `authenticated`. |

```sql
select p.proname, p.proacl from pg_proc p
where p.pronamespace = 'public'::regnamespace order by p.proname;
```

### `search_path` hardening on every `SECURITY DEFINER` function

Every `SECURITY DEFINER` function (`get_shared_report`,
`enable_report_share`, `revoke_report_share`, `before_user_created_hook`)
sets `search_path = ''` (empty), not `= public`, and every relation/function
reference inside them is schema-qualified (`public.reports`,
`extensions.gen_random_bytes`, ...) — Supabase's own linter recommendation.
An empty search_path means Postgres can never resolve an unqualified name
against a same-named object planted earlier in the path — notably
`pg_temp`, which every session searches FIRST, ahead of any explicit
schema, even one set via `search_path = public`. There is no demonstrated
live exploit for this in a read-mostly, connection-pooled setup, but it
costs nothing and is the recommended posture for every `SECURITY DEFINER`
function, not just the ones with an obvious current risk. `replace_reports`
is `SECURITY INVOKER`, not `DEFINER` — unaffected, left as `public.`-
qualified already for readability, no `search_path` setting needed.

### Signup is closed by an email-domain allowlist

Open signup (`enable_signup = true` + a real, readable RLS surface) would be
a hole the moment Phase 7b's route handlers exist, so it's closed in the same
phase the RLS went live, via a Postgres `before_user_created` Auth Hook
(`supabase/config.toml [auth.hook.before_user_created]` → `public.
before_user_created_hook(event jsonb)`, wired to a `public.
allowed_signup_domains` table). This is a genuine server-side auth-server
hook (GoTrue calls this function before it ever inserts the `auth.users`
row), not a client-side/application-layer check — it cannot be bypassed by a
client that skips its own UI validation. To add an allowed domain: `insert
into public.allowed_signup_domains (domain) values ('example.com')`
(lowercase, no leading `@`) via a follow-up migration (production) or
directly via psql/Studio (local dev) — no redeploy required either way.

**The domain allowlist alone is necessary but was NOT sufficient** — it
only proves the domain is right, never that the caller controls the
specific mailbox. Verified exploit before this was caught: `POST
/auth/v1/signup {"email":"intruder@arcytex.com","password":"..."}` (an
allowlisted domain, but a mailbox the caller doesn't own) returned a usable
session **immediately**, because `supabase/config.toml [auth.email]
enable_confirmations` was `false` — full read/write access to every report
via the open `using (true)` SELECT policies and the `reports_insert`
policy, with no proof of mailbox control ever required. Fixed by setting
`enable_confirmations = true`: a brand-new password signup now returns a
user object with `session: null` until the emailed confirmation link is
followed. `[auth.email] enable_signup` (a DIFFERENT knob) was tried as an
additional lockdown and reverted — it's the master switch for the entire
email provider, not a narrow "password signup only" toggle; setting it
`false` also broke magic-link sign-in for legitimate new users AND password
sign-in for the already-existing seed users. It must stay `true`.
`supabase/config.toml` only governs a *hosted* Supabase project once
`supabase config push` (or the dashboard) applies it — verify the deployed
project's actual auth settings independently in the dashboard at Phase 9
deploy time, don't assume this file alone describes production.

### Per-report share tokens

`reports.share_token` (`text`, `unique`, nullable, NULL by default) is an
**opt-in** public share token — sharing a report is a deliberate per-report
action, never on by default. Tokens are generated server-side only
(`encode(gen_random_bytes(32), 'hex')`) and are never accepted from the
client. The only anon-reachable read path is `public.get_shared_report(token
text) returns jsonb` — deliberately a `SECURITY DEFINER` function, NOT an
anon `SELECT` policy: an anon policy would need to expose `share_token` as a
filterable column, and this app's report ids (`r1`, `d1`, ...) are
guessable, so a policy-based approach could be walked by id. The function
only ever accepts a token (never an id) and only ever returns the single
report whose `share_token` matches it (with its `tasks`/`risks`/
`priorities` nested, each ordered by `position`), or `NULL` if the token is
null, empty/whitespace-only, or doesn't match any row — `reports.share_token
IS NULL` rows can never match a null/empty argument (guarded explicitly in
the function body, not left to SQL's `NULL = NULL` semantics alone).
`execute` on the function is granted to `anon` AND `authenticated`; there is
no `SELECT`/`UPDATE` grant on `reports` itself for `anon`.

**Enabling/revoking a share link is NOT a plain UPDATE** (post-review
hardening) — three layers close the gap between "the column comment says
server-generated only" and that actually being enforced:

1. **`reports_share_token_format` CHECK**: `share_token is null or
   share_token ~ '^[a-f0-9]{32,}$'` — rejects trivially guessable values
   (verified before this landed: a client could `PATCH` `share_token` to
   `"abc"` directly and it was brute-forceable against `get_shared_report`
   in 60 guesses).
2. **Column-privilege revoke**: `authenticated`'s `INSERT`/`UPDATE` grants on
   `reports` are narrowed to every column EXCEPT `share_token` — a direct
   `PATCH .../reports?id=eq.mine {"share_token": "..."}` now fails at the
   grant layer (`42501`/"permission denied for table reports"), regardless
   of RLS or the CHECK above, even for that report's own owner.
3. **`public.enable_report_share(report_id text) returns text`** /
   **`public.revoke_report_share(report_id text) returns void`** — the ONLY
   path that can actually write `share_token`. Both are owner-or-admin-only
   (re-implementing the ownership check by hand, since `SECURITY DEFINER`
   bypasses RLS entirely) and `enable_report_share` generates the token
   itself server-side. Phase 7b's Share dialog "Enable public link"/"Revoke"
   buttons call these — 7a lands the schema surface only, no UI.

### `created_at` / `updated_at`: `date` → `timestamptz`

Both columns were widened from `date` to `timestamptz` (with `default
now()`) in this migration, via `using (created_at::timestamp at time zone
'UTC')` — **not** a bare `::timestamptz` cast. Verified why that distinction
matters: under a non-UTC session timezone (e.g. `set timezone =
'Asia/Tokyo'`), `'2026-06-05'::date::timestamptz` resolves to `2026-06-05
00:00:00+09`, which is `2026-06-04 15:00:00 UTC` — the date silently rolls
back a full day the moment anything reads it back in UTC. Supabase defaults
every connection to UTC, so this was latent, not live, but it's exactly the
bug class CLAUDE.md's "no `Date`-based timezone math, dates are ISO
strings" rule exists to prevent, and it's what actually guarantees the
stored instant means midnight UTC on that calendar day, unconditionally,
regardless of the server/session timezone.

**Not a correctness fix for anything shipped so
far** — `updatedAt` is only ever *displayed* (`fmtDateShort` in
`DashboardScreen`/`DailyListScreen`), and report consolidation orders by
`weekEnd`, not `updatedAt`. It's landed now because Phase 7b's `updateReport`
is a fetch → merge-in-TypeScript → write-back operation, which is a
lost-update race under concurrent users; the standard fix is optimistic
concurrency keyed on `updated_at`, which needs sub-day resolution to work at
all — cheap to land here, expensive to retrofit once Phase 7b's mapping
layer exists. **The TS side is deliberately unchanged**: `createdAt`/
`updatedAt` stay `z.string()` (`lib/schema/report.ts`), and `nowDate()`
(`lib/format.ts`) still returns `yyyy-mm-dd`. **Correction (post-review):
`fmtDateShort`/`parseISO` (`lib/format.ts`) required a fix, not just an
assumption, to actually keep working on a full timestamptz string** — the
original `parseISO` did `s.split('-').map(Number)`, and a PostgREST-returned
value like `"2026-07-13T00:00:00+00:00"` parsed to `{ d: NaN }`, rendering
`"Jul NaN, 2026"`. `parseISO` now takes only the first 10 characters
(`s.slice(0, 10)`) before splitting — a no-op for a plain `yyyy-mm-dd`
string, and what actually makes a full timestamp string degrade correctly.
Not a live 7a bug (no repository reads a Postgres row yet), but the fix
landed in the same phase as the type widening rather than waiting to be
discovered in 7b. **Follow-up for Phase 7b**: `lib/server/db-mapping.ts`
should own the read-side normalization, and `updateReport` should add the
actual optimistic-concurrency check against `updated_at`.

### `api_tokens` (schema only — Phase 8 feature)

```sql
create table api_tokens (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,   -- sha-256 hex; plaintext never stored
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,   -- post-review addition, unused in Phase 7
  revoked_at timestamptz    -- post-review addition, unused in Phase 7
);
```

`expires_at`/`revoked_at` were added post-review, while the table is still
empty (cheapest possible time): without them, "revoke" would have had to be
a bare `DELETE` (no audit trail of when/that a token was ever revoked).
Both are nullable and untouched by anything in Phase 7 — Phase 8 designs
the actual revoke/expiry UX and validator logic against them.

RLS: a user may `select`/`insert`/`delete` only their own tokens (`user_id =
auth.uid()`); there is no `update` policy — tokens are create/revoke only,
and Phase 8's service-role token validator is what updates `last_used_at`
(service-role bypasses RLS). **`SELECT` is column-restricted** (post-review
hardening, same rationale as `reports.share_token`): `token_hash` is a
verifier, never something a client should read back, so `authenticated`'s
column-level grant excludes it — `revoke select on api_tokens from
authenticated; grant select (id, user_id, label, created_at, last_used_at,
expires_at, revoked_at) on api_tokens to authenticated;`. No UI or
validation reads/writes this table in Phase 7 — the schema lands now purely
so it's versioned alongside the rest of the auth domain.

### `public.replace_reports(payload jsonb, skip_existing boolean default false)`

The transactional write path Phase 7b's CSV import and localStorage→
Supabase import will call: one round-trip upserts a `reports` row plus
replaces its `tasks`/`risks`/`priorities` (delete-by-`report_id` + reinsert,
`position` from array order) — atomic, instead of Phase 7b hand-rolling N
separate round-trips per report. **`SECURITY INVOKER` is the load-bearing
property**: it runs as the calling `authenticated` role with the caller's
own JWT, so every RLS policy above still applies *inside* the transaction —
the function adds atomicity, never privilege escalation (a non-admin caller
still cannot touch another user's report through this function; the "member
replace_reports on admin's id → error" case is enforced by RLS, not by the
function itself).

The `payload` shape is an array of objects shaped like the SQL rows
themselves (snake_case columns, matching this document's field-mapping
tables — e.g. `week_start`, `project_id`, `touchpoint_calls`), each carrying
nested `tasks`/`risks`/`priorities` arrays — NOT the camelCase TS domain
shape. Phase 7b's `lib/server/db-mapping.ts` owns translating `AnyReport` ↔
this shape before/after calling the function. `owner_id` in the payload is
respected on a brand-new insert (defaulting to the caller's own
`auth.uid()` if omitted) but is **never** overwritten on an update (`on
conflict (id) do update` explicitly excludes it from the `SET` list) — this
is what preserves a report's original owner across re-imports.
`skip_existing: true` skips (and reports) any `id` already present instead
of overwriting it — this is the mechanism that makes the eventual
localStorage→Supabase import idempotent and safe to re-run (every browser's
`localStorage` has the same seed ids like `r1`; an id already in Postgres is
skipped, never clobbered). Returns `{"imported": [ids], "skipped": [ids]}`.

## Cutover checklist

**Before anything else: use `ReportCoreInputSchema`/`AnyReportInputSchema`
(`lib/schema/report.ts`), never `ReportCoreSchema`/`AnyReportSchema`
directly, to validate a request body.** The latter are the ROW shape
(`ownerId`/`shareToken` included, because `ReportCore`/`AnyReport` need to
type them for reads); parsing an untrusted request body against them would
let a client-supplied `ownerId`/`shareToken` pass straight through
unchallenged, since Zod only strips *unknown* keys and these are now known
ones on that schema. RLS still blocks a foreign `ownerId` at the database
layer, but `shareToken` has no such backstop by design (see "Per-report
share tokens" above) — the `*InputSchema` variants `.omit()` both fields
specifically so this can't happen by accident.

1. Implement `SupabaseReportsRepository` in `lib/data/`, satisfying the
   existing `ReportsRepository` interface (`getAll`/`getAllDaily`/`getById`/
   `upsert`/`update`/`getProjects`/`upsertProject`, the latter two added
   Phase 6a) — UI code never changes, since it only ever calls
   `getReportsRepository()` (`lib/data/index.ts`). `getAll()` filters to
   `kind = 'weekly'`, `getAllDaily()` to `kind = 'daily'` — both against the
   same `reports` table (see "Discriminated union ↔ single table" above).
2. Map camelCase (TS) ↔ snake_case (SQL) per the field-mapping tables above.
   `getAll`/`getAllDaily`/`getById` join `tasks`/`risks`/`priorities`
   (ordered by `position`) back into each report object, and reconstruct
   the TS union (`kind = 'weekly'` rows get `weekStart`/`weekEnd`, `kind =
   'daily'` rows get `date`, per `reports_period_by_kind`); `upsert`/`update`
   write the `reports` row plus replace its child rows (delete + reinsert by
   `report_id`, re-deriving `position` from array order, is the simplest
   correct strategy given these are small per-report lists).
3. One-time import: read every existing browser's `ff.reports.v2`
   localStorage payload (both kinds — the pre-Phase-4 `ff.weekly-reports.v1`
   key is superseded by it, see `LocalStorageReportsRepository`'s v1→v2
   migration) and `upsert` each `AnyReport` through the new repository (ids
   import verbatim — see "Text ids" above). **Phase 6a addition:** also read
   `ff.projects.v1` (`Project[]`) and `upsert` each through the new
   repository's `upsertProject()` BEFORE importing reports (so the FK
   references resolve); every task/risk/report's `projectId` (already
   backfilled client-side by `ensureProjectIds()`, or `null`/absent for a
   house record) must be carried through into the corresponding
   `tasks.project_id` / `risks.project_id` / `reports.project_id` columns,
   not dropped.
4. Swap the single switch point: `getReportsRepository()` in
   `lib/data/index.ts` returns `SupabaseReportsRepository` instead of
   `LocalStorageReportsRepository`.
5. Post-cutover drift check: run `supabase gen types typescript` and diff
   the generated types against `lib/types.ts` / this document whenever
   either changes, to catch schema/type drift early.

See also `CLAUDE.md`: *"Any PR that changes `lib/types.ts` domain shapes
must add a `supabase/migrations/*.sql` delta and update the mapping tables
in this document."*
