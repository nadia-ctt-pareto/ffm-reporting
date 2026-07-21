# Database Schema — Weekly Reports Dashboard

Baseline schema for `HttpReportsRepository` (see
`lib/data/reports-repository.ts` / `lib/data/http-reports-repository.ts`,
Phase 7b). The migration itself lives at
`supabase/migrations/20260717000001_initial_schema.sql`, with a Phase 4
delta at `supabase/migrations/20260717000002_daily_reports.sql`, a
Phase 6a delta (the Project entity) at
`supabase/migrations/20260718000003_projects.sql`, a Phase 7a delta
(auth, ownership, real RLS, per-report share tokens, the transactional
import RPC, and the `created_at`/`updated_at` type widening) at
`supabase/migrations/20260719000004_auth_ownership.sql` — see "Auth,
ownership, and RLS (Phase 7a)" below — a Phase 7b post-review-hardening
delta (closing a share-token read leak found in code review, plus
server-stamping `updated_at`) at
`supabase/migrations/20260720000005_post_review_hardening.sql` — see
"Post-review hardening (Phase 7b)" below — a Phase 7b round-2
post-review-hardening delta (matching SQL CHECK constraints + a child-row
count cap for the app's write-boundary length caps, plus `replace_reports`
returning the real `updated_at` it wrote) at
`supabase/migrations/20260720000006_post_review_hardening_round2.sql` — see
"Post-review hardening, round 2 (Phase 7b)" below — a Phase 8a delta
(the MCP bearer-token verify/revoke RPCs) at
`supabase/migrations/20260721000007_mcp_tokens.sql` — see "`verify_api_token`
/ `revoke_api_token` (Phase 8a)" below — and a Phase 7c delta (the BYOK AI
key table + its ciphertext-read RPC) at
`supabase/migrations/20260722000008_ai_keys.sql` — see "`ai_keys` (BYOK,
Phase 7c)" below.

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
| `ownerId`                    | `owner_id`                   | `uuid`, nullable | Phase 7a. FK → `auth.users(id)`. NULL = system/unclaimed (admin-editable only). See "Auth, ownership, and RLS (Phase 7a)" below. **Deliberately still broadcast to every authenticated user** (SHOULD-FIX I, "Post-review hardening, round 2" below) -- unlike `shareToken`, an opaque UUID among coworkers at one small agency isn't a live risk, and it's the natural column a future owner-aware affordance would already need selected. |
| `shareToken`                 | `share_token`                | `text`, nullable, `unique` | Phase 7a. Opt-in public share token, NULL by default. Server-generated only, never client-supplied. See "Per-report share tokens (Phase 7a)" below. |
| `tasks`                      | *(joined from `tasks`)*     | —         | `where report_id = reports.id order by position` |
| `risks`                      | *(joined from `risks`)*     | —         | `where report_id = reports.id order by position` |
| `priorities`                 | *(joined from `priorities`)*| —         | `where report_id = reports.id order by position` |

**Length/range CHECK constraints** (Phase 7b round 2,
`supabase/migrations/20260720000006_post_review_hardening_round2.sql`):
`id` ≤ 200 chars; `prepared_for`/`prepared_by`/`win_stat`/`win_label` ≤ 500
chars; `summary_narrative`/`win_narrative`/`touchpoints_narrative` ≤ 20,000
chars; `touchpoint_calls`/`touchpoint_emails`/`touchpoint_escalations`
between 0 and 100,000; `project_id` ≤ 200 chars where non-NULL. These mirror
`lib/schema/report.ts`'s `*InputSchema` write-boundary bounds exactly (see
"Post-review hardening, round 2" below for why they exist at the SQL layer
too, not just in Zod).

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

**Length CHECK constraints** (Phase 7b round 2, same migration as above):
`id` ≤ 200 chars; `client` ≤ 500 chars; `task` ≤ 20,000 chars; `project_id`
≤ 200 chars where non-NULL. **Row-count CHECK** (same migration): a trigger
(`public.enforce_child_row_cap()`) rejects a report's 501st `tasks` row --
see "Post-review hardening, round 2" below for why a plain array-length cap
in Zod alone isn't sufficient (it only guards this app's own route
handlers, not a direct PostgREST insert against this table).

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

**Length CHECK constraints**: `id` ≤ 200 chars; `client` ≤ 500 chars;
`description`/`next_step` ≤ 20,000 chars; `project_id` ≤ 200 chars where
non-NULL. **Row-count CHECK**: same `enforce_child_row_cap()` trigger as
`tasks` above, capped at 500 `risks` rows per report.

## Field mapping: `priorities`

| TS field (`Priority`) | Column      | Type      | Notes                                     |
| ----------------------- | ----------- | --------- | ------------------------------------------ |
| `id`                     | `id`        | `text` PK |                                            |
| —                        | `report_id` | `text`    | FK → `reports(id)`, `on delete cascade`    |
| `text`                   | `text`      | `text`    |                                            |
| —                        | `position`  | `integer` | preserves array order                      |

**Length CHECK constraints**: `id` ≤ 200 chars; `text` ≤ 20,000 chars.
**Row-count CHECK**: same `enforce_child_row_cap()` trigger as `tasks`/
`risks` above, capped at 500 `priorities` rows per report.

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
| `get_report_share_token(text)` (Phase 7b, 20260720000005) | `authenticated` only | Same rationale as `enable_report_share`/`revoke_report_share` — owner-or-admin-gated internally, `anon` has no account to own a report with. See "Post-review hardening (Phase 7b)" below. |
| `verify_api_token(text)` (Phase 8a, 20260721000007) | `anon` only | The MCP auth bridge's bare anon client is the only real caller — see "`verify_api_token` / `revoke_api_token` (Phase 8a)" below. |
| `revoke_api_token(text)` (Phase 8a, 20260721000007) | `authenticated` only | Owner-gated internally, same rationale as `enable_report_share`/`revoke_report_share`. |
| `set_own_ai_key(text, text)` (Phase 7c, 20260722000008) | `authenticated` only | `auth.uid()`-scoped write path for `ai_keys.key_ciphertext` — see "`ai_keys` (BYOK, Phase 7c)" below for the verified reason a plain client-side upsert cannot do this. |
| `get_own_ai_key_ciphertext()` (Phase 7c, 20260722000008) | `authenticated` only | `auth.uid()`-scoped read path for `ai_keys.key_ciphertext` — same section. |

```sql
select p.proname, p.proacl from pg_proc p
where p.pronamespace = 'public'::regnamespace order by p.proname;
```

### `search_path` hardening on every `SECURITY DEFINER` function

Every `SECURITY DEFINER` function (`get_shared_report`,
`enable_report_share`, `revoke_report_share`, `before_user_created_hook`,
`get_report_share_token` (Phase 7b), `verify_api_token`/`revoke_api_token`
(Phase 8a), `set_own_ai_key`/`get_own_ai_key_ciphertext` (Phase 7c)) sets
`search_path = ''` (empty), not `= public`, and every relation/function
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

### `api_tokens` (schema landed Phase 7a; wired up in Phase 8a)

```sql
create table api_tokens (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,   -- sha-256 hex; plaintext never stored
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,   -- post-review addition, unused until Phase 8a (still unset by anything in this app -- no UI writes it)
  revoked_at timestamptz    -- post-review addition, set by revoke_api_token() (Phase 8a) below
);
```

`expires_at`/`revoked_at` were added post-review in Phase 7a, while the
table was still empty (cheapest possible time): without them, "revoke"
would have had to be a bare `DELETE` (no audit trail of when/that a token
was ever revoked). `revoked_at` is now live (Phase 8a, see
`revoke_api_token` below); `expires_at` is still nullable and unset by
anything in this app — a future phase could add an optional expiry UI
without a schema change.

RLS: a user may `select`/`insert`/`delete` only their own tokens (`user_id =
auth.uid()`); there is no `update` policy — tokens are create/revoke only.
Phase 8a's `verify_api_token`/`revoke_api_token` (both `SECURITY DEFINER`,
below) are the only paths that can write `last_used_at`/`revoked_at`
despite that — see each function's own comment for why a `DEFINER` function
is what a missing `UPDATE` policy actually forces here. **`SELECT` is
column-restricted** (post-review hardening, same rationale as
`reports.share_token`): `token_hash` is a verifier, never something a
client should read back, so `authenticated`'s column-level grant excludes
it — `revoke select on api_tokens from authenticated; grant select (id,
user_id, label, created_at, last_used_at, expires_at, revoked_at) on
api_tokens to authenticated;`. `app/api/tokens/route.ts`'s GET is the only
reader in this app, and it selects exactly that column list (never `*`).

### `verify_api_token` / `revoke_api_token` (Phase 8a)

`supabase/migrations/20260721000007_mcp_tokens.sql` — the SQL half of the
MCP bearer-token auth bridge (`lib/server/mcp-auth.ts` is the other half;
read that file's header comment for the full per-request flow and the
explicit security argument). Both functions follow `enable_report_share`'s
exact posture (`security definer`, `set search_path = ''`, schema-qualified
names, hand-written ownership/validity checks, `revoke ... from public,
anon, authenticated` then a narrow, explicit `grant`).

```sql
create function public.verify_api_token(p_token text) returns uuid
  security definer set search_path = ''
-- Hashes p_token (extensions.digest(..., 'sha256'), hex-encoded --
-- byte-for-byte the same algorithm/encoding as
-- lib/server/mcp-auth.ts's hashApiTokenForStorage), looks it up in
-- api_tokens, rejects a revoked/expired match, stamps last_used_at,
-- returns the owning user_id (or NULL for anything else -- missing,
-- garbage, revoked, expired; the caller never learns WHICH). A single
-- atomic `UPDATE ... RETURNING` (not a SELECT then a separate UPDATE)
-- closes the obvious TOCTOU window between checking validity and
-- stamping last_used_at.

create function public.revoke_api_token(p_token_id text) returns void
  security definer set search_path = ''
-- Owner-only (auth.uid() = api_tokens.user_id). Sets revoked_at = now()
-- (idempotent via coalesce(revoked_at, now()) -- a second call on an
-- already-revoked token of your own keeps the original timestamp and
-- still succeeds) -- never a DELETE, preserving the audit trail. Raises
-- 42501 if the id does not exist or is not owned by the caller.
```

**Grants** (verified via `pg_proc.proacl`, matching this document's existing
"verify, never just re-read the `revoke` statement" discipline):
`verify_api_token` → `anon` only (the MCP bridge always calls it via the
bare, cookie-less anon client, lib/supabase/anon.ts — there is no session to
be "authenticated" as at that point; deliberately narrower than
`get_shared_report`'s `anon, authenticated` grant, since nothing in this app
ever calls `verify_api_token` from an authenticated session).
`revoke_api_token` → `authenticated` only (mirrors
`enable_report_share`/`revoke_report_share` — `anon` has no account, so no
token to revoke).

| Function | Reachable by | Rationale |
|---|---|---|
| `verify_api_token(text)` | `anon` only | The whole point — the bare anon client is the ONLY caller (lib/supabase/anon.ts); 256-bit token entropy makes online guessing moot, same posture as `get_shared_report`'s share tokens. |
| `revoke_api_token(text)` | `authenticated` only | Owner-gated internally; `anon` has no account to own a token with. |

**Route handlers**: `app/api/tokens/route.ts` (GET list / POST create —
POST server-generates the token, `node:crypto.randomBytes(32)` base64url,
`ffmcp_`-prefixed, hashed via `hashApiTokenForStorage` before a plain
`INSERT` through the cookie-bound client under `api_tokens_insert` RLS —
`verify_api_token` is never called from this route, it exists purely for
the MCP bridge) and `app/api/tokens/[id]/route.ts` (DELETE → calls
`revoke_api_token` via the cookie-bound client, since `api_tokens` has no
`UPDATE` policy of its own for a plain `PATCH` to use instead).

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

## Post-review hardening (Phase 7b)

`supabase/migrations/20260720000005_post_review_hardening.sql` closes two
findings from code review of the (otherwise Phase-7a-complete) M1+M2 data
plane. Neither changes `lib/types.ts`/`lib/schema/` domain shapes — this is
a pure RLS/grant/function-body delta, landed as its own migration per
CLAUDE.md's migrations-discipline rule regardless.

### `reports.share_token` was readable by every authenticated user (BLOCKER)

`reports_select` (Phase 7a) is `using (true)` with **no column
restriction** — `lib/server/reports-service.ts`'s `reportsQuery` selected
`'*'`, so `GET /api/reports` returned every report's `share_token`,
including reports the caller doesn't own, to every signed-in user. Any
authenticated user could mint a fully-working **anonymous** share link
(`/reports/<id>/present?t=<token>`) for a report they don't own, without
ever calling `enable_report_share()` — the whole point of that RPC being
owner-or-admin-gated. Fixing the API layer alone is insufficient: the same
caller can bypass this app entirely with the anon key + their own JWT
(`GET /rest/v1/reports?select=id,share_token`), since `reports_select` has
no column-level restriction of its own.

Two layers, mirroring the `api_tokens.token_hash` column-grant precedent
(20260719000004_auth_ownership.sql):

1. **Column-level grant**: `authenticated`'s SELECT on `reports` is
   revoked and re-granted for every column EXCEPT `share_token`. Postgres
   treats `SELECT *` as equivalent to naming every column at the privilege
   layer, so `lib/server/reports-service.ts`'s `reportsQuery` had to switch
   from `select('*', ...)` to an explicit column list in the SAME commit
   this migration landed in — `*` fails outright (42501) the moment the
   grant is live. Verified: `curl
   "$SUPABASE_URL/rest/v1/reports?select=id,share_token" -H "apikey: $ANON"
   -H "Authorization: Bearer $MEMBER_JWT"` now returns
   `42501`/"permission denied for table reports" instead of every report's
   token; a control query (`select=id,status`) still succeeds, proving
   legitimate reads are unaffected.
2. **`public.get_report_share_token(report_id text) returns text`** — a
   new owner-or-admin-gated `SECURITY DEFINER` function, hand-rolling the
   identical ownership check `enable_report_share`/`revoke_report_share`
   already use (SECURITY DEFINER bypasses RLS, so the check has to be
   re-implemented here too). This is the ONLY read path left for
   `share_token` — `GET /api/reports/[id]/share` (new route handler,
   `app/api/reports/[id]/share/route.ts`) calls it, designed for Milestone
   M3's ShareDialog (show/copy an already-enabled link without re-minting
   one). `execute` granted to `authenticated` only, same rationale as the
   sibling enable/revoke functions.

`lib/server/db-mapping.ts`'s `ReportRow` interface no longer declares
`share_token` at all (it's simply absent from every row `reportsQuery`
returns now, not present-and-null) — `rowToReport` emits no `shareToken`
key, which is a valid `AnyReport` since that field is `.nullish()`
(optional key) on `AnyReportSchema`.

### `POST /api/reports` let a client forge `reports.updated_at` (SHOULD-FIX)

`replace_reports` used to take `updated_at` straight from the payload on
both the insert branch (`coalesce((rec->>'updated_at')::timestamptz,
now())`) and the on-conflict-update branch (`updated_at =
excluded.updated_at`) — since `AnyReportInputSchema` includes `updatedAt`
and `lib/server/db-mapping.ts`'s `reportToRow` forwards it verbatim, a
client could backdate/forward-date its own reports' "Last Updated" (the
only audit signal the UI shows) via a plain `POST /api/reports`, and could
defeat `updateReport`'s `expectedUpdatedAt` optimistic-concurrency CAS
(added in 7a for Phase 8's `update_report` MCP tool) by holding
`updated_at` constant across writes through the POST path.

Fix: `replace_reports` now stamps `updated_at = now()` itself on BOTH
branches, unconditionally ignoring whatever the payload said. `created_at`
is deliberately left payload-controlled on insert (unchanged) — a
legitimate import (CSV, the eventual localStorage→Supabase import) needs to
preserve a record's true original creation date, and creation-date forgery
was not the vector this finding flagged. Verified directly against
Postgres: `POST /api/reports` with a payload carrying `updatedAt:
"1999-01-01T00:00:00Z"` persists a `created_at` matching the payload's
(forgeable, by design) `createdAt`, but `updated_at` matching the actual
wall-clock time of the write, not the forged value.

## Post-review hardening, round 2 (Phase 7b)

`supabase/migrations/20260720000006_post_review_hardening_round2.sql`
closes findings from a SECOND round of code review, against the fixes the
first round landed. Two independent reviewers re-verified round 1's fixes
directly against the live database before this round started — those
verifications are recorded in the round-1 section above and were not
re-run here; this section covers only what round 1 itself introduced.

### BLOCKER A — round 1's new `.max()` caps landed on the READ schema, over columns with no matching SQL constraint

Round 1 (SHOULD-FIX 8, see `lib/schema/report.ts`) added `.max()`
length/count caps to close an unbounded-request-body finding, but put them
on `ReportCoreSchema` — the shared schema
`lib/server/reports-service.ts`'s `listReports`/`getReport` parse every ROW
against — rather than only the `*InputSchema` write-boundary variants.
Postgres had no matching constraint at the time: every `reports`/`tasks`/
`risks`/`priorities` text column was unbounded `text`. Because `mapRow`
threw for the WHOLE request on a single failed parse, and `reports_select`
is `using (true)` (every authenticated user can read every report), this
turned a legitimate write into a cross-user outage:

**Confirmed exploited end-to-end.** As `member@` (owner of their own
report), `PATCH $SUPABASE_URL/rest/v1/reports?id=eq.<their-report>
{"summary_narrative": "A"×25000}` — allowed by `reports_update` RLS, since
they own the row, bypassing this app's own `POST`/`PATCH` handlers (and
their now-bounded `*InputSchema` validation) entirely via the public anon
key + their own JWT. `GET /api/reports` then 500'd for **every** signed-in
user, including `dev@` (admin) — not just `member@` — with no in-app
recovery (the poisoned report couldn't be listed, opened, or patched back
through the API; only a direct DB fix could clear it).

**Fix — three independent layers, not one:**

1. **The `.max()` caps moved OFF the read schema** (`ReportCoreSchema` and
   every nested Task/Risk/Priority/Win/Touchpoints read schema,
   `lib/schema/report.ts`) **onto DEDICATED `*InputSchema` variants**
   (`TaskInputSchema`, `RiskInputSchema`, `PriorityInputSchema`,
   `WinInputSchema`, `TouchpointsInputSchema`, `ReportCoreInputSchema`) —
   the actual write boundary SHOULD-FIX 8 meant them to land on. The read
   schema is unconditionally permissive again (matching its pre-round-1
   shape) — a read schema must stay satisfiable by construction; validation
   that can reject data the database legitimately contains is an
   availability bug, not a safety feature.
2. **THIS migration**: SQL CHECK constraints matching every `*InputSchema`
   bound exactly (see the field-mapping tables above for the full list) —
   closes the gap layer (1) alone can't: a client hitting PostgREST
   directly, bypassing this app's route handlers entirely, is now ALSO
   capped at the database layer. **Verified**: the exact exploit payload
   above (`update reports set summary_narrative = repeat('A', 25000) ...`)
   now fails outright with `ERROR: new row for relation "reports" violates
   check constraint "reports_summary_narrative_len"` — no row is written,
   nothing to 500 on afterward.
3. **`listReports` (`lib/server/reports-service.ts`) now skip-and-logs** a
   single non-conforming row (via a new `safeMapRow` helper) instead of
   throwing for the whole batch — `mapRow` (still throwing) is reserved for
   single-row reads (`getReport`, `updateReport`'s own re-read), where "the
   one report the caller asked for is unreadable" is the correct,
   narrowly-scoped failure. This is a backstop for the case where the
   schema and the database disagree DESPITE (1)/(2) — a future drift now
   degrades to "one report silently missing from the list" (still logged
   server-side) instead of "the whole list, for everyone, is down."

**Child-row-count enforcement** ("if practical", per the review): the
round-1 `MAX_CHILD_ROWS = 500` array-length cap only ever bounded what
THIS app's own route handlers accept in one `tasks`/`risks`/`priorities`
array — it can't stop a client from directly `INSERT`ing unlimited rows
into those tables via PostgREST, since `tasks_insert` (and its risks/
priorities siblings, Phase 7a) only check ownership of the parent report,
not a row count. `public.enforce_child_row_cap()`, a per-row `AFTER INSERT`
trigger attached to all three child tables, closes this: it raises a
`23514` (check_violation, mapped to HTTP 400) once a report's count for
that table exceeds 500. A per-row (not statement-level/transition-table)
trigger was chosen deliberately for implementation simplicity and because
`report_id` is already indexed on all three tables, so each check is a
cheap indexed count; the app's own `.max(500)` array cap already bounds how
many times this can fire per report per request in practice. **Verified**:
inserting 501 task rows for one report in a single transaction raises
`Report r1 already has the maximum of 500 tasks rows.` and rolls back; a
normal single-row insert well under the cap still succeeds.

### BLOCKER B, SHOULD-FIX D–I

The remaining round-2 findings (a CSV-import partial-commit retry that
could duplicate weekly reports; a dead-on-arrival `expectedUpdatedAt` CAS;
`ServiceError` messages that weren't always curated before reaching the
client; an overly permissive CSRF `Sec-Fetch-Site` check; a
`Transfer-Encoding: chunked` body-size bypass; a discarded server error
message on the report screen; `loadError` left unrendered on several
routes; and a decision on whether to keep broadcasting `reports.owner_id`)
are **app-layer fixes with no additional schema delta** — see
`lib/server/reports-service.ts`, `lib/server/route-helpers.ts`,
`lib/server/request-guards.ts`, `components/settings/CsvImportSection.tsx`,
`components/report/ReportScreen.tsx`, and the five route-wrapper files each
listed in their own doc comments. The one exception folded into THIS
migration instead of a code-only fix: `replace_reports` (see below).

### `replace_reports` now returns the real `updated_at` it wrote (SHOULD-FIX C, second half)

Round 1 made `replace_reports` server-stamp `updated_at = now()` itself,
but `updateReport` (`lib/server/reports-service.ts`) still computed its OWN
`new Date().toISOString()` for the value it returned to its caller — a
value from THIS NODE PROCESS'S clock, which can legitimately disagree with
Postgres's (skew, or a request straddling a UTC-midnight boundary). That
was harmless while the return value was discarded, but a same-phase fix
(SHOULD-FIX 14, round 1) now writes it straight into React state, making it
live, user-visible data. Fixed by having `replace_reports` report back what
it ACTUALLY wrote: its jsonb result gained an `updatedAt` key — an object
mapping every imported (non-skipped) id to the real `updated_at` it was
just stamped with, captured via `INSERT ... ON CONFLICT DO UPDATE ...
RETURNING updated_at INTO ...` inside the existing per-report loop, no
extra round-trip. `updateReport` looks up its own single id in this map
instead of guessing. **Verified**: calling `replace_reports` with a payload
whose own `updated_at` is a forged `"1999-01-01T00:00:00Z"` (unchanged from
round 1's own verification) returns the ACTUAL wall-clock write time in
its `updatedAt` map, not the forged value and not a locally-computed one.

The `expectedUpdatedAt` CAS half of SHOULD-FIX C (comparing against the
DOMAIN-normalized, not raw, `updated_at`) is an app-layer-only change — see
`lib/server/reports-service.ts`'s `updateReport` and `lib/schema/api.ts`'s
`ReportPatchSchema` doc comment.

## `ai_keys` (BYOK, Phase 7c)

`supabase/migrations/20260722000008_ai_keys.sql` — the schema half of the
BYOK AI field-polish feature (`lib/server/ai-crypto.ts` encrypts/decrypts;
`lib/server/ai-keys.ts` is the service layer that calls this schema;
`lib/server/ai-polish.ts` is the actual Anthropic call — read all three
alongside this section for the full picture). One row per user: their
Anthropic API key, AES-256-GCM-encrypted at rest.

### Column mapping

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` PK | FK → `auth.users(id)`, `on delete cascade`. `default auth.uid()` is a defensive fallback, not load-bearing for this app's own write path — every real write goes through `set_own_ai_key()` (below), which sets `user_id` explicitly. (A subquery form, `default (select auth.uid())`, is rejected outright by Postgres — "cannot use subquery in DEFAULT expression" — verified; a column DEFAULT must be a plain function call.) |
| `key_ciphertext` | `text` | `base64(iv (12 bytes) \|\| authTag (16 bytes) \|\| ciphertext)`, AES-256-GCM. The encryption key is `AI_BYOK_ENCRYPTION_KEY`, a Next server-only env var — **never present in Postgres in any form.** Not client-SELECTable OR client-writable directly (see "Column grants" below); read via `get_own_ai_key_ciphertext()`, written via `set_own_ai_key()` — both `SECURITY DEFINER`. |
| `key_hint` | `text` | Display-only fingerprint (e.g. `sk-ant-...ab12`), computed server-side from the plaintext at save time — never derived from `key_ciphertext`, never the key itself. |
| `created_at` | `timestamptz` | Standard bookkeeping, DB-defaulted. |
| `updated_at` | `timestamptz` | Stamped by `set_own_ai_key()` (server `now()`, never a client-supplied timestamp — same posture as `replace_reports` stamping `reports.updated_at` itself). |
| `validated_at` | `timestamptz`, nullable | Stamped by `set_own_ai_key()` from the SAME `now()` as `updated_at` — the key was just successfully validated against Anthropic (a 1-token ping to `POLISH_MODEL`, run BEFORE this function is ever called — an invalid key never reaches it). |
| `last_used_at` | `timestamptz`, nullable | Stamped by `get_own_ai_key_ciphertext()` every time the ciphertext is READ for a polish attempt — not gated on whether the subsequent Anthropic call succeeds (see that function's comment; mirrors `verify_api_token`'s "one round trip" precedent). |

### Threat model (app-level AES-256-GCM, the chosen approach)

Weighed against `pgcrypto` (key passed per-query, so it either lives in the
DB — no protection at all — or transits SQL text where `log_statement`
could capture it) and Supabase Vault (built for project-level secrets, not
per-user rows — any role able to `select vault.decrypted_secrets` gets
plaintext, and per-user row-scoping on Vault views is awkward). App-level
AES-256-GCM in the Next server runtime, key from `AI_BYOK_ENCRYPTION_KEY`,
is the honest choice for a per-user secret:

| Threat | Protected? |
| --- | --- |
| Stolen DB dump / backup | **Yes** — the dump contains ciphertext only; the encryption key never touches Postgres. |
| Compromised app server / malicious deploy | **No — and nothing can fix this.** A server that proxies calls to Anthropic must be able to decrypt. This is stated plainly, not papered over: it is out of scope for any server-proxied BYOK design, not a gap specific to this implementation. |
| Admin user via SQL/PostgREST | **Yes** — an admin can see ciphertext at most (and cannot even do that — see "Column grants" below); the decryption key exists only in the app's env, which repo admins ≠ DB admins may not share. |

### Why NO `is_admin()` branch — deliberately tighter than every other table

Every other table in this schema (`reports`, `tasks`, `risks`,
`priorities`, `projects`) gives `public.is_admin()` a bypass on top of
owner-scoped RLS — reasonable, since an admin legitimately needs to manage
the org's reports. `ai_keys` has **no such branch on any verb** (select/
insert/update/delete all read strictly `user_id = (select auth.uid())`,
full stop): an admin's job is reports, never another user's personal
Anthropic API key. Applying the existing `is_admin()` pattern here by
habit would have been the wrong default — this was a deliberate exception,
not an oversight, and it's the single thing to double-check first if this
table is ever touched again.

### Column grants — and a VERIFIED GOTCHA that shaped the write path

`key_ciphertext` is excluded from `authenticated`'s SELECT grant entirely
(the `api_tokens.token_hash` / `reports.share_token` precedent — Postgres
treats `SELECT *` as naming every column, so this closes even an
accidental future `select('*')`, and a direct PostgREST call with the anon
key + a user's own JWT). `authenticated` gets **no INSERT or UPDATE grant
on `ai_keys` at all** — every write to `key_ciphertext` (and, since there's
no reason to write the other columns independently of it, every write to
the row at all) goes through `set_own_ai_key()` below. DELETE stays a
plain table-level grant to `authenticated` (RLS-scoped) — DELETE doesn't
reference column *values*, so none of the below applies to it.

**Why writes need a `SECURITY DEFINER` function too, not just reads
(verified live, not theoretical):** the first version of this schema
granted `authenticated` a column-scoped UPDATE on `key_ciphertext`, meant
to be reached via a plain client-side `.upsert(...).onConflict('user_id')`
— mirroring the read side's column-grant pattern. This does **not** work:
Postgres requires **SELECT** privilege on any column referenced as
`excluded.<column>` inside an `ON CONFLICT ... DO UPDATE SET` clause, and
`authenticated` deliberately has no SELECT on `key_ciphertext`. Verified
directly via `psql` (`set role authenticated; set request.jwt.claims =
...`), isolating one `SET` clause at a time: `on conflict (user_id) do
update set key_ciphertext = excluded.key_ciphertext` failed with
`permission denied for table ai_keys`, while the identical statement with
`set key_hint = excluded.key_hint` (or `updated_at`, or `validated_at`)
succeeded — and a plain `INSERT` with no `ON CONFLICT` clause at all also
succeeded. The two properties this table needs — "authenticated can write
`key_ciphertext`" and "authenticated can never read `key_ciphertext`" —
are mutually exclusive for a directly-executed upsert. `set_own_ai_key()`
resolves this the same way `enable_report_share`/`get_own_ai_key_ciphertext`
already resolve the analogous read-side problem: run the privileged
operation as the function owner (full table access) instead of the calling
role.

### `set_own_ai_key(p_key_ciphertext text, p_key_hint text)`

```sql
create function public.set_own_ai_key(p_key_ciphertext text, p_key_hint text) returns timestamptz
  security definer set search_path = ''
-- auth.uid()-scoped, no id argument. Insert-or-replace via
-- ON CONFLICT (user_id) DO UPDATE -- see "Column grants" above for why
-- this specifically must be SECURITY DEFINER. Stamps validated_at/
-- updated_at from ONE now() captured at the top of the function (never a
-- client-supplied timestamp) and returns the validated_at it wrote.
```

**Grants**: `authenticated` only, same rationale as `get_own_ai_key_ciphertext`
below. Called by `lib/server/ai-keys.ts`'s `setAiKey`, AFTER
`validateAnthropicKey` has already confirmed the key against Anthropic — an
invalid key never reaches this function, and therefore is never stored.

### `get_own_ai_key_ciphertext()`

```sql
create function public.get_own_ai_key_ciphertext() returns text
  security definer set search_path = ''
-- auth.uid()-scoped, no argument -- there is no legitimate reason for this
-- to ever read anyone else's row. A single atomic UPDATE ... RETURNING
-- (not a SELECT then a separate UPDATE) stamps last_used_at and returns
-- the ciphertext in one round trip -- mirrors verify_api_token's
-- TOCTOU-closing technique exactly (Phase 8a,
-- 20260721000007_mcp_tokens.sql). Returns NULL if the caller has no
-- stored key (never raises for that case).
```

**Grants** (verified via `pg_proc.proacl`, per this document's own "verify,
never just re-read the `revoke` statement" discipline): `authenticated`
only, for both functions above. `anon` is excluded entirely from either —
unlike `verify_api_token` (anon-only, because an MCP request carries no
session at all), these need `auth.uid()` to resolve to something, which
requires an authenticated session.

| Function | Reachable by | Rationale |
|---|---|---|
| `set_own_ai_key(text, text)` | `authenticated` only | The only write path for `ai_keys.key_ciphertext` — needs a real session for `auth.uid()` to resolve; `anon` has no account to own a key with. |
| `get_own_ai_key_ciphertext()` | `authenticated` only | The only read path for `ai_keys.key_ciphertext` — same rationale. |

### Operational note: `AI_BYOK_ENCRYPTION_KEY` rotation/loss

**Rotating or losing `AI_BYOK_ENCRYPTION_KEY` makes every previously-stored
key permanently undecryptable.** There is no recovery path other than each
affected user re-entering their key in Settings — `lib/server/ai-crypto.ts`
degrades this to the `ai_key_unreadable` curated error ("re-enter your
key"), never a 500. Before rotating this value in production: expect every
BYOK user to need to re-save their key afterward, and communicate that
ahead of the rotation. Same "server-only, never `NEXT_PUBLIC_*`" rule as
`SUPABASE_JWT_SECRET` — see `.env.example`'s block for the local dev value
(`openssl rand -base64 32`).

### Route handlers

`app/api/ai/key/route.ts` (GET status / PUT save-or-replace / DELETE
remove) and `app/api/ai/polish/route.ts` (POST — the actual polish call).
Both gated on `isAiPolishConfigured()` (`lib/server/ai-crypto.ts`):
`isSupabaseConfigured() && Boolean(process.env.AI_BYOK_ENCRYPTION_KEY)` —
404 when false, mirroring `isMcpConfigured()`'s posture exactly.

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
