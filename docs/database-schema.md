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
/ `revoke_api_token` (Phase 8a)" below — a Phase 7c delta (the BYOK AI
key table + its ciphertext-read RPC) at
`supabase/migrations/20260722000008_ai_keys.sql` — see "`ai_keys` (BYOK,
Phase 7c)" below — a Phase 9 delta (the production signup-domain
allowlist) at `supabase/migrations/20260723000009_production_signup_domains.sql`
— a Phase 8b delta (OAuth 2.1 + dynamic client registration for
claude.ai) at `supabase/migrations/20260724000010_oauth.sql` — see "OAuth
2.1 for claude.ai custom connectors (Phase 8b)" below — and a task
completion date delta (a nullable `tasks.completed_at` plus the matching
`replace_reports` update) at
`supabase/migrations/20260725000014_task_completed_at.sql` — see "Task
completion date" below.

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
| `completedAt`       | `completed_at` | `date`, nullable | Task completion date delta (`supabase/migrations/20260725000014_task_completed_at.sql`). Same `''` ↔ `NULL` convention as `deadline`. Auto-stamped the moment a task's status becomes `'Complete'` (any write path), cleared when it moves off `'Complete'`, editable afterward. See "Task completion date" below. |
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
| `id`                    | `id`   | `text` PK          | slug (e.g. `helitech-foundation-waterproofing`); immutable post-create -- see "Project management (Phase 8c)" below |
| `name`                  | `name` | `text`, `unique`   | exact display string used throughout the UI; the ONLY column `authenticated` may UPDATE (Phase 8c column grant) |

Phase 8c adds project list/create/rename/delete UI (`/projects`,
`/projects/[id]`) over this same table -- see "Project management (Phase
8c)" below for the one grant change it required.

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
| `set_own_ai_key(text, text, text, text, text)` (Phase 7c, 20260722000008; signature extended by the BYOK generalization delta, 20260724000012) | `authenticated` only | `auth.uid()`-scoped write path for `ai_keys.key_ciphertext` (and, since 20260724000012, `provider`/`base_url`/`model`) — see "`ai_keys` (BYOK, Phase 7c)" below for the verified reason a plain client-side upsert cannot do this. The original 2-arg overload was explicitly dropped when the 5-arg one was added (see that migration). |
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

## `ai_keys` (BYOK, Phase 7c; generalized to any provider, delta migration 20260724000012)

`supabase/migrations/20260722000008_ai_keys.sql` — the schema half of the
BYOK AI field-polish feature (`lib/server/ai-crypto.ts` encrypts/decrypts;
`lib/server/ai-keys.ts` is the service layer that calls this schema;
`lib/server/ai-polish.ts` builds the actual provider request — read all
three alongside this section for the full picture). One row per user: their
BYOK API key, AES-256-GCM-encrypted at rest. **Originally Anthropic-only;
`supabase/migrations/20260724000012_ai_keys_providers.sql` generalized this
to any provider** — see "BYOK generalization: any provider (delta)" below
for what that migration added; everything else on this page describes the
unchanged Phase 7c foundation (`key_ciphertext` itself, the crypto, the RLS
posture, both `SECURITY DEFINER` functions' core shape).

### Column mapping

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` PK | FK → `auth.users(id)`, `on delete cascade`. `default auth.uid()` is a defensive fallback, not load-bearing for this app's own write path — every real write goes through `set_own_ai_key()` (below), which sets `user_id` explicitly. (A subquery form, `default (select auth.uid())`, is rejected outright by Postgres — "cannot use subquery in DEFAULT expression" — verified; a column DEFAULT must be a plain function call.) |
| `key_ciphertext` | `text` | `base64(iv (12 bytes) \|\| authTag (16 bytes) \|\| ciphertext)`, AES-256-GCM. The encryption key is `AI_BYOK_ENCRYPTION_KEY`, a Next server-only env var — **never present in Postgres in any form.** Not client-SELECTable OR client-writable directly (see "Column grants" below); read via `get_own_ai_key_ciphertext()`, written via `set_own_ai_key()` — both `SECURITY DEFINER`. Unchanged by the provider generalization — opaque to every SQL role regardless of which provider it's a key for. |
| `key_hint` | `text` | Display-only fingerprint (e.g. `sk-ant-...ab12`), computed server-side from the plaintext at save time — never derived from `key_ciphertext`, never the key itself. |
| `provider` | `text`, default `'anthropic'` | **New (20260724000012).** `'anthropic'` or `'openai_compatible'`. Non-secret — see the column grant below. CHECK-constrained (`ai_keys_provider_check`). |
| `base_url` | `text`, nullable | **New (20260724000012).** Non-secret. `NULL` for `provider='anthropic'` (fixed base, never user-controlled). Required for `provider='openai_compatible'` (`ai_keys_openai_compatible_requires_fields` CHECK) — SSRF-validated server-side, both at save time and at every polish call (`lib/server/ssrf.ts`'s `assertSafeOutboundUrl`) — see "BYOK generalization" below. `char_length <= 500` (`ai_keys_base_url_len`). |
| `model` | `text`, nullable | **New (20260724000012).** Non-secret. `NULL` for `provider='anthropic'` (defaults to `lib/server/ai-polish.ts`'s `POLISH_MODEL`) or an explicit override. Required for `provider='openai_compatible'`. `char_length <= 200` (`ai_keys_model_len`). |
| `created_at` | `timestamptz` | Standard bookkeeping, DB-defaulted. |
| `updated_at` | `timestamptz` | Stamped by `set_own_ai_key()` (server `now()`, never a client-supplied timestamp — same posture as `replace_reports` stamping `reports.updated_at` itself). |
| `validated_at` | `timestamptz`, nullable | Stamped by `set_own_ai_key()` from the SAME `now()` as `updated_at` — the key was just successfully validated against the REAL provider (a 1-token ping — Anthropic Messages or OpenAI-compatible Chat Completions, depending on `provider` — run BEFORE this function is ever called — an invalid key never reaches it). |
| `last_used_at` | `timestamptz`, nullable | Stamped by `get_own_ai_key_ciphertext()` every time the ciphertext is READ for a polish attempt — not gated on whether the subsequent provider call succeeds (see that function's comment; mirrors `verify_api_token`'s "one round trip" precedent). |

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

### `set_own_ai_key(p_key_ciphertext text, p_key_hint text, p_provider text default 'anthropic', p_base_url text default null, p_model text default null)`

```sql
create function public.set_own_ai_key(
  p_key_ciphertext text, p_key_hint text,
  p_provider text default 'anthropic', p_base_url text default null, p_model text default null
) returns timestamptz
  security definer set search_path = ''
-- auth.uid()-scoped, no id argument. Insert-or-replace via
-- ON CONFLICT (user_id) DO UPDATE -- see "Column grants" above for why
-- this specifically must be SECURITY DEFINER. Stamps validated_at/
-- updated_at from ONE now() captured at the top of the function (never a
-- client-supplied timestamp) and returns the validated_at it wrote.
```

**Signature history**: originally `(p_key_ciphertext text, p_key_hint text)`
(Phase 7c). `20260724000012_ai_keys_providers.sql` (the BYOK generalization
delta) extended it to also accept/set `provider`/`base_url`/`model` —
Postgres treats a different argument count as a NEW, DISTINCT overload
(`create or replace` alone would have left the old 2-arg signature callable
alongside this one), so that migration explicitly `drop function if exists
public.set_own_ai_key(text, text)` FIRST. Only the 5-arg signature exists
now (verified via `pg_proc` — see "Function EXECUTE grants" above, exactly
one row for `set_own_ai_key`).

**Grants**: `authenticated` only, same rationale as `get_own_ai_key_ciphertext`
below. Called by `lib/server/ai-keys.ts`'s `setAiKey`, AFTER the
provider-appropriate validation call (`validateAnthropicKey` or
`validateOpenAiCompatibleKey`, `lib/server/ai-polish.ts`) has already
confirmed the key (and, for `openai_compatible`, the base URL + model)
against the REAL provider — an invalid key/endpoint never reaches this
function, and therefore is never stored.

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
| `set_own_ai_key(text, text, text, text, text)` | `authenticated` only | The only write path for `ai_keys.key_ciphertext` (and, since 20260724000012, `provider`/`base_url`/`model` too) — needs a real session for `auth.uid()` to resolve; `anon` has no account to own a key with. |
| `get_own_ai_key_ciphertext()` | `authenticated` only | The only read path for `ai_keys.key_ciphertext` — same rationale. Unchanged by the provider generalization; `provider`/`base_url`/`model` are read separately, via the plain column-grant select in `getAiKeyProviderConfig` (`lib/server/ai-keys.ts`), never through this function. |

### BYOK generalization: any provider (delta, `20260724000012_ai_keys_providers.sql`)

Two provider modes cover essentially every hosted LLM provider:

- **`anthropic`** — the native Anthropic Messages API (the original Phase 7c
  behavior, unchanged): `sk-ant-...` key, `x-api-key` header, fixed
  `https://api.anthropic.com/v1/messages` — never user-controlled.
- **`openai_compatible`** — the OpenAI Chat Completions request/response
  shape (`Authorization: Bearer` key, `{base_url}/chat/completions`), which
  covers OpenRouter, OpenAI itself, Groq, Together, DeepSeek, Mistral, and
  most other hosted providers. The user supplies BOTH `base_url` and
  `model` (required — enforced by `ai_keys_openai_compatible_requires_fields`).

**What changed at the SQL layer**: three new non-secret columns
(`provider`/`base_url`/`model`, see "Column mapping" above), two new shape
CHECK constraints, two new length-cap CHECK constraints, `set_own_ai_key()`'s
signature extended (see that function's own section above), and the
`authenticated` column-SELECT grant widened to include the three new
columns (same "revoke, then re-grant the full widened list" pattern as
`supabase/migrations/20260724000010_oauth.sql`'s `api_tokens` delta) —
`key_ciphertext` stays excluded, unchanged.

**SSRF is an application-layer concern, not a SQL one.** `base_url` is
USER-CONTROLLED for `openai_compatible`, and the server makes an outbound
fetch to it — a naive implementation would let a user point this server's
own network access at an internal service (localhost, a private-network
peer, a cloud metadata endpoint) simply by saving that address as their
`base_url`. SQL can constrain the column's SHAPE (a string, ≤500 chars) but
has no way to evaluate "is this host safe to fetch from the app server's
network" — that entirely lives in `lib/server/ssrf.ts`'s
`assertSafeOutboundUrl`:

- `https://` only (rejects `http:` and every other scheme) — enforced at
  BOTH the schema layer (`SetAiKeyInputSchema`'s `.startsWith('https://')`,
  a fast-fail 400 before any network call) and here (the real,
  unconditional gate).
- Rejects `localhost`/`*.localhost` and known cloud-metadata hostnames
  (`169.254.169.254`, `metadata.google.internal`) by name, before any DNS
  resolution.
- Rejects an IP-literal host, OR any DNS-resolved address for a hostname
  host, that falls in a private/loopback/link-local/ULA/CGNAT/reserved
  range (IPv4: `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`,
  `0.0.0.0/8`, `100.64/10`; IPv6: `::1`, `fc00::/7`, `fe80::/10`, `::`).
  **SEC-1 (post-review): four DIFFERENT embedded-IPv4 forms are unwrapped
  and the embedded address re-checked against the SAME IPv4 range list** —
  IPv4-mapped (`::ffff:a.b.c.d`, `::ffff:0:0/96`), IPv4-compatible
  (`::a.b.c.d`, `::/96`, deprecated but still a valid literal), NAT64
  (`64:ff9b::a.b.c.d`, `64:ff9b::/96`, RFC 6052 — a REAL escalation path on
  an IPv6-only/NAT64 runtime: `64:ff9b::a9fe:a9fe` synthesizes to
  `169.254.169.254`, cloud metadata, and would otherwise sail straight past
  every other check), and 6to4 (`2002:WWXX:YYZZ::`, `2002::/16`, RFC 3056 —
  the embedded address sits at bits 16-47, not the low 32 bits like the
  other three, and 6to4 is INSIDE global unicast `2000::/3`, so a naive
  "allow `2000::/3`" allowlist would not have caught it either). The
  original version of this function only handled the first (IPv4-mapped)
  form — the other three were a live bypass, closed here.
- Every outbound fetch also passes `redirect: 'error'` — a provider cannot
  3xx this server into an internal address after the check passes.
- Applied at BOTH save time (`validateOpenAiCompatibleKey`, called from
  `setAiKey` before anything is encrypted/stored) AND every polish call
  (`callOpenAiCompatible`) — defense-in-depth, in case the two ever drift or
  a row is edited directly in Postgres.
- **DNS rebinding / TOCTOU — CLOSED, not just documented (SEC-3, post-review).**
  A resolve-then-fetch alone only closes this if literally nothing happens
  between the check and the connect — never true for a real `fetch()`
  against a default dispatcher, since it re-resolves DNS itself moments
  later; a malicious DNS server could serve a public address for the FIRST
  lookup and a private one for the SECOND. `assertSafeOutboundUrl` now
  returns the exact address(es) it validated, and `buildPinnedDispatcher`
  (same file) turns them into an `undici` `Agent` whose `connect.lookup`
  ALWAYS returns those SAME addresses — no second resolution ever happens.
  Requires pairing with `undici`'s OWN exported `fetch` (not Node's global
  one — verified live that the global `fetch` rejects a dispatcher built
  from a separately-installed `undici` package, an `instanceof` identity
  mismatch against Node's own internal, non-importable undici copy), which
  is why `undici` is now a direct dependency (`package.json`) and why
  `callOpenAiCompatible` imports `fetch` from it explicitly. Verified live
  against a real public host (`scripts/verify-ssrf.ts`): pinning to the
  address that host actually resolved to succeeds with a normal TLS
  handshake (SNI/Host/cert validation are computed from the URL by undici's
  own connector, unaffected by the pin); pinning to a deliberately WRONG
  address times out/fails — proving the override genuinely controls the
  connection rather than silently falling back to a fresh, real lookup.
- **SEC-2 (post-review): the SAVE-TIME validation call is rate-limited
  too**, not just the polish call — an earlier version let
  `PUT /api/ai/key` fire an unthrottled, attacker-influenceable outbound
  fetch to an arbitrary external host on every save (an external-
  reachability oracle: distinct curated markers + latency leak whether a
  host:port is reachable). `validateOpenAiCompatibleKey`/`validateAnthropicKey`
  now run through the SAME per-user `withProviderRateLimit` `polishField`
  uses — one shared budget across both actions, not a separate pool.

Unit-tested in `scripts/verify-ssrf.ts` (the SSRF/pinning mechanism itself,
including a real network round-trip proving the pin) and
`scripts/verify-byok-providers.ts` (request shape, error mapping, the
shared rate-limit budget, and SSRF defense-in-depth on the polish path) —
see each script's own header comment.

**Error mapping is provider-neutral where it needs to be, provider-specific
where it should be.** `lib/server/reports-service.ts`'s `curatedMessage`
gained parallel `openai_*` marker-token cases alongside the ORIGINAL,
unchanged `anthropic_*` ones (401/403 → key rejected; 404/400 →
`openai_bad_endpoint`, "check the base URL and model"; 429 →
`openai_rate_limited`; timeout/5xx → `openai_unavailable`/`openai_timeout`).
Anthropic ALSO gained a narrower `anthropic_bad_model` case (404 only — its
base URL is never user-controlled, so only the model can be wrong) once the
BYOK generalization made Anthropic's `model` user-overridable too; without
it, a bad model id fell through to the generic "Couldn't reach Anthropic"
bucket, which reads like a network problem rather than "you typed a model
that doesn't exist." The per-user local rate limiter
(`lib/server/ai-polish.ts`) was changed from reusing the
`anthropic_rate_limited` marker to a new provider-neutral
`local_rate_limited` marker — reusing the Anthropic-specific one would have
mislabeled an `openai_compatible` user's local throttle as an Anthropic-
account problem. No response body from either provider is ever forwarded to
a log or a client — only the HTTP status code is read out of a failed
response (a 401 body can echo back the last characters of a bad key).

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

## OAuth 2.1 for claude.ai custom connectors (Phase 8b)

`supabase/migrations/20260724000010_oauth.sql` layers OAuth 2.1 + RFC 7591
Dynamic Client Registration on top of Phase 8a's MCP server so claude.ai's
connector UI (which cannot send a static bearer header) can reach the same
`/api/mcp` endpoint. **The layering invariant, confirmed live, not assumed:
an OAuth-issued access token is JUST another `api_tokens` row, verified by
the EXACT SAME `verify_api_token` RPC (Phase 8a, 20260721000007) a
`POST /api/tokens`-minted bearer token goes through.** `verify_api_token`
needed **zero changes** — it hashes whatever text it's given and looks up
`token_hash`, indifferent to which of the two issuance paths produced the
row. `lib/server/mcp-auth.ts`, `lib/server/mcp-tools.ts`, and
`app/api/[transport]/route.ts` are **untouched** by this phase.

### New tables

```sql
create table oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,        -- CHECK: every element must pass oauth_redirect_uris_allowlisted()
  created_at timestamptz not null default now()
);

create table oauth_codes (
  code_hash text primary key,           -- sha-256 hex; plaintext never stored
  client_id text not null references oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,         -- S256 only, system-wide
  expires_at timestamptz not null,      -- 10-minute TTL
  used_at timestamptz,                  -- stamped atomically on redemption -- NULL = still redeemable
  created_at timestamptz not null default now()
);
```

`oauth_clients`: one row per DCR'd claude.ai connector installation — a
*client*, not a *user*. **Public clients only** — there is no
`client_secret` column at all; every client authenticates via PKCE
(`token_endpoint_auth_methods_supported: ["none"]`). RLS: `select` to
`authenticated` only (the consent screen looks up a client's display
name/redirect_uris); **no insert/update/delete policy for any role** —
`oauth_register_client()` (below) is the only path that can create a row.

`oauth_codes`: one row per issued authorization code. **RLS is enabled with
ZERO policies** — default-deny for every command, every role, including
`select`, except the functions' owner (verified live: a superuser-inserted
probe row is invisible to both `anon` and `authenticated` via a plain
`select count(*)`, even though the row genuinely exists). `code_challenge`
is stored in the clear (a PUBLIC value from the original `/oauth/authorize`
request — PKCE's whole point is that only `code_verifier`, sent for the
first time at token-exchange, is secret); `code_hash` is what is actually
secret, exactly like `api_tokens.token_hash`.

**Redirect URI allowlist — THE primary control** against DCR being turned
into a code-exfiltration channel: `public.oauth_redirect_uris_allowlisted
(text[]) returns boolean` (plain SQL, `immutable`) is TRUE iff every
element is `https://`, host exactly `claude.ai`/`claude.com` or a subdomain
of either. It backs `oauth_clients`' own CHECK constraint AND is called
again inside `oauth_register_client()` — a bug in either alone can't smuggle
a bad redirect_uri in. **Three layers total**, counting `app/oauth/register
/route.ts`'s own `lib/server/oauth.ts#isAllowedRedirectUri` (real WHATWG
`URL` parsing — correctly rejects a userinfo-smuggled host like
`https://claude.ai@evil.com/x`, whose `.hostname` resolves to `evil.com`,
not `claude.ai`). Verified against attack strings live (see "Verification"
below): `https://evilclaude.ai/x`, `https://claude.ai.evil.com/x`,
`https://claude.ai@evil.com/x` all REJECTED; `https://claude.ai/x`,
`https://console.claude.com/x` both accepted. **A plain SQL function, not
inlined into the CHECK constraint directly** — Postgres does not allow a
subquery (which iterating `unnest()` requires) inside a CHECK expression at
all (`cannot use subquery in check constraint`); wrapping the same logic in
a function call sidesteps that restriction.

### `api_tokens` extension

```sql
alter table api_tokens
  add column kind text not null default 'mcp' check (kind in ('mcp', 'oauth')),
  add column oauth_client_id text references oauth_clients (client_id) on delete cascade,
  add column refresh_token_hash text unique,
  add column refresh_expires_at timestamptz;  -- see this migration for why independent from expires_at
```

`kind='mcp'` = a Phase 8a `POST /api/tokens` bearer token; `kind='oauth'` =
issued by `oauth_exchange_code`/`oauth_refresh_token` below. `expires_at`
(already existing, Phase 7a) is reused as the OAuth access token's own
expiry (~30 days) — `verify_api_token` already checks it, unmodified.
`refresh_expires_at` is a **necessary addition beyond the plan's literal
column list** (not scope creep): an access token and its paired refresh
token need genuinely independent expiries (~30d vs ~90d); reusing one
column for both would either expire the refresh token early or let it
outlive its stated budget. Landed while every row's value was still NULL —
same "cheapest possible time to extend the schema" precedent as 7a's
`expires_at`/`revoked_at` addition.

**Column-privilege lockdown (surfaced while extending this table, not a
regression introduced here — 7a never restricted `api_tokens`' INSERT
columns at all, unlike its own `reports.share_token` precedent in the SAME
migration; fixed here as a direct, narrowly-scoped consequence of adding
four new sensitive columns)**: `authenticated`'s INSERT grant is now
restricted to exactly `{id, user_id, token_hash, label}` — verified
compatible with `app/api/tokens/route.ts`'s POST, which inserts precisely
those four columns and nothing else. None of `kind`/`oauth_client_id`/
`refresh_token_hash`/`refresh_expires_at` (nor `expires_at`/`revoked_at`/
`last_used_at`, already server-only in practice) can ever be set via a
direct client INSERT — every write to them goes through a `SECURITY
DEFINER` function. The existing column-restricted SELECT grant (7a) was
widened to also expose `kind`/`oauth_client_id`/`refresh_expires_at` (all
non-secret) — `refresh_token_hash` is deliberately EXCLUDED, same
rationale as `token_hash` itself.

### The four new functions

All four follow `enable_report_share`/`verify_api_token`'s exact posture
(`security definer`, `set search_path = ''`, schema-qualified names,
hand-written checks, generate-secret-in-SQL-return-once, `revoke ... from
public, anon, authenticated` then a narrow, explicit `grant`).

| Function | Reachable by | Rationale |
|---|---|---|
| `oauth_redirect_uris_allowlisted(text[])` | nobody (not `security definer`; revoked from all client roles anyway, for hygiene) | Pure predicate, shared by the CHECK constraint and `oauth_register_client()` — no legitimate direct caller. |
| `oauth_register_client(text, text[])` | `anon` only | RFC 7591 DCR is unauthenticated by protocol — there is no session to be "authenticated" as. |
| `oauth_create_authorization_code(text, text, text)` | `authenticated` only | Called from the consent screen's Approve action — `(select auth.uid())` is the consenting user, never a parameter. |
| `oauth_exchange_code(text, text, text, text)` | `anon` only | Token exchange is a direct client-to-server call, never via browser redirect — the code + PKCE verifier together ARE the proof of identity. |
| `oauth_refresh_token(text, text)` | `anon` only | Same rationale — the refresh token itself is the proof of identity. |

**`oauth_register_client`**: re-validates the redirect_uri allowlist itself
(second of three layers — see above) before generating a fresh
`client_<uuid>` id. **Capped at 500 total rows** (post-review should-fix —
see "DCR is anon-callable and unbounded" below) — rejects new registrations
once the table holds 500 clients, regardless of caller.

**`oauth_create_authorization_code`**: re-validates client_id/redirect_uri
pairing AGAINST THE SPECIFIC CLIENT (not just "some allowlisted domain") —
verified live: client A requesting a code for client B's registered
redirect_uri is rejected, even though that redirect_uri passes the global
allowlist. Generates a 32-random-byte, base64url code, hex-hashes it for
storage (mirrors `api_tokens.token_hash`), 10-minute TTL.

**`oauth_exchange_code`**: the security core. Atomically consumes the code
(TOCTOU-safe `UPDATE ... RETURNING`, identical idiom to `verify_api_token`),
then checks `client_id` match, `redirect_uri` match, and PKCE S256
(`base64url(sha256(code_verifier)) = code_challenge`, hand-rolled in SQL —
`encode(..., 'base64')` + a `translate`/`rtrim` alphabet-swap, byte-for-byte
equivalent to `lib/server/mcp-auth.ts`'s `base64url()`). Every failure
raises the literal message `'invalid_grant'`, chosen deliberately —
`app/oauth/token/route.ts` maps it straight through as the OAuth `error`
field verbatim (it already IS the correct RFC 6749 code for "bad code",
"expired", "wrong client", "wrong redirect_uri", AND "PKCE mismatch" alike
— an oracle distinguishing these would let an attacker learn which guess
was closest). **Important, verified live, not just reasoned about: a
REJECTED exchange does not burn the code** — every `raise exception` below
the atomic consume aborts the WHOLE transaction (one RPC call = one
transaction), rolling back the `used_at` stamp along with everything else.
A wrong client_id/redirect_uri/PKCE guess costs an attacker nothing in
extra leverage (guessing a 256-bit `code_verifier` is infeasible
regardless) but also can never deny the legitimate holder their code —
confirmed by inspecting `oauth_codes.used_at` directly after a rejected
cross-client attempt (still NULL), then successfully redeeming the SAME
code afterward with the correct client. On success: mints a fresh
`api_tokens` row (`kind='oauth'`) via the SAME generate-in-SQL-hash-
return-once pattern as `enable_report_share`, plus a rotating hashed
refresh token; the row's `label` is set from the client's own registered
`client_name` (falling back to "Claude.ai connector") so it reads
sensibly in the existing Settings token list.

**`oauth_refresh_token`**: rotates IN PLACE — a single atomic `UPDATE`
whose `WHERE` clause encodes the ENTIRE validity check (`kind='oauth'`,
`oauth_client_id` match, `refresh_token_hash` match, not revoked, not
refresh-expired) and, on match, overwrites both the access-token hash and
the refresh-token hash on the SAME row. The OLD refresh token stops
matching anything the instant this succeeds — replaying it fails
identically to an unknown token (`invalid_grant`) — verified live. The
prior access token is also invalidated by this (its hash was just
overwritten), which is intentional: once refreshed, the old access/refresh
pair is fully superseded.

### Verification performed (local Supabase, live)

- **SQL-level**: full register → authorize → exchange → verify_api_token
  round-trip with a REAL PKCE S256 verifier/challenge pair (computed via
  `openssl dgst -sha256`); code replay rejected; cross-client exchange
  rejected; PKCE mismatch rejected; refresh rotation + old-refresh-replay
  rejection; DCR evil `redirect_uri` rejected; authorize-time
  redirect_uri-not-registered-to-this-client rejected; unauthenticated code
  creation rejected.
- **HTTP-level, via a real Chrome browser (Playwright) + the actual
  `/login` form**: unauthenticated `GET /oauth/authorize` → redirected to
  `/login?next=...` with the FULL original query string preserved (the
  `middleware.ts` fix this phase required); real password login; correct
  landing back on the consent screen (client name + user email rendered
  correctly); Approve → real redirect to the registered `https://claude
  .ai/...` callback with `code` + `state`; token exchange via
  `application/x-www-form-urlencoded` (matching
  `@modelcontextprotocol/sdk/client/auth.js` exactly) succeeded; Deny →
  redirect with `error=access_denied`; the issued token used against a REAL
  `/api/mcp` tool call (`list_reports`, `create_report`) through the
  UNTOUCHED `withMcpAuth`/`verifyMcpAuth` bridge — `create_report` wrote a
  row whose `owner_id` is the consenting user's uuid (never NULL);
  attempting `update_report` on a DIFFERENT user's report with the same
  token was rejected ("You don't have permission to do that.") and that
  row was verified byte-unchanged in the database afterward; `get_report`
  on that same foreign report succeeded (org-wide read policy, by design).
- **Grants**: every new `SECURITY DEFINER` function's `pg_proc.proacl`
  checked directly (not just the `revoke` statement's intent) — see the
  table above.
- **Regression**: the pre-existing Phase 8a bearer-token path (`POST
  /api/tokens` → `/api/mcp` `initialize`) and the web dashboard both still
  work unmodified.
- **Not driven locally** (needs the deployed HTTPS origin): a real
  claude.ai custom-connector handshake end-to-end. Everything up to that
  point (DCR, PKCE, consent, token issuance, the MCP bridge) was verified
  using the exact request shapes `@modelcontextprotocol/sdk`'s own client
  code sends.

### Issuer/origin: `APP_ORIGIN` pins it (post-review BLOCKER fix)

**Corrected finding, not the original design**: this section used to say
Phase 8b needed no new env var, deriving every OAuth endpoint's issuer/
resource origin per-request from `mcp-handler`'s `getPublicOrigin()`
(`X-Forwarded-Host`/`X-Forwarded-Proto`, falling back to `Forwarded`, then
the request's own URL). That trusts a forwarded-host header
UNCONDITIONALLY — combined with the two `.well-known` metadata responses
being cacheable (`Cache-Control: max-age=3600`), this is a host-header
**cache-poisoning** primitive: a request with a spoofed
`X-Forwarded-Host: evil.com` could make `/.well-known/oauth-authorization-server`
advertise `token_endpoint: https://evil.com/oauth/token` (and
`/.well-known/oauth-protected-resource` advertise a matching
`authorization_servers` entry) — if that response were ever cached and
served to another client, claude.ai would send a VICTIM's real
authorization code + PKCE verifier straight to the attacker's server. Full
account takeover, not a theoretical concern.

**Fix, both layers, belt-and-suspenders:**
1. **`APP_ORIGIN`** (server-only env var, see `.env.example`) — when set,
   `lib/server/oauth.ts`'s `getIssuerOrigin()` uses it VERBATIM for
   `issuer`/`authorization_endpoint`/`token_endpoint`/`registration_endpoint`/
   `authServerUrls`/`resourceUrl`, ignoring the request's forwarded-host
   headers entirely. Falls back to `getPublicOrigin(request)` only when
   `APP_ORIGIN` is unset — i.e. local dev, where there's no untrusted
   reverse proxy between the developer and `next dev`. **Required in
   production** — verified live: with `APP_ORIGIN` set, both `.well-known`
   routes return the pinned origin regardless of a spoofed
   `X-Forwarded-Host: evil.com` request header; with it unset, the request
   header IS reflected (the local-dev fallback, working as designed).
2. **`Cache-Control: no-store`** on both `.well-known` routes (was
   `max-age=3600`) — removes the caching half of the exploit entirely, even
   as defense in depth on top of the pinned origin.

**The `WWW-Authenticate` residual (documented, not fixed — would require
touching the untouchable bridge file)**: `app/api/[transport]/route.ts`
(confirmed byte-unchanged this phase) calls `withMcpAuth(handler,
verifyMcpAuth, { required: true })` without a `resourceUrl` option, so
mcp-handler's own 401 handler still derives its `WWW-Authenticate:
resource_metadata="..."` URL from `getPublicOrigin(req)` — the SAME
host-trusting default `.well-known/oauth-protected-resource` used to have.
Pinning this would mean passing `{ resourceUrl: APP_ORIGIN }` into that
`withMcpAuth(...)` call, which this phase's scope explicitly forbids
touching (the whole security model depends on that file staying
byte-identical to Phase 8a's reviewed version) — flagged here rather than
edited. Practical impact is bounded, verified from `mcp-handler`'s own
compiled source: that 401 response carries **no `Cache-Control` header at
all** (not even implicitly cacheable), so a spoofed forwarded-host header
here only affects the response to THAT SAME spoofed request — there is no
caching layer to poison and serve to other users the way the (now-fixed)
`.well-known` routes' `max-age=3600` responses could have. This is a
known, narrow limitation of the vendor library's default behavior, not an
open exploit path in this app's current deployment shape; worth a
follow-up if mcp-handler ever adds a way to pin it without a full
`withMcpAuth` rewrite.

`SUPABASE_JWT_SECRET` (already documented above) remains a prerequisite —
every Phase 8b endpoint 404s under the same `isMcpConfigured()` gate as
`/api/mcp` itself; `APP_ORIGIN`'s absence does NOT 404 anything (it's a
silent fallback), so double-check it's actually set before a production
deploy.

### DCR is anon-callable and unbounded — a cap + pruning path (post-review should-fix)

`oauth_register_client` has no auth, no rate limit, and (before this fix)
no cap — an attacker looping `POST /oauth/register` with valid
`claude.ai/*` redirect_uris could otherwise grow `oauth_clients` without
limit (storage/table-bloat DoS). Proportionate for a 2–10-user internal
tool: a **hard cap of 500 total rows**, enforced inside
`oauth_register_client` itself (`select count(*) from oauth_clients >=
500` → reject) — verified live (500 rows inserted, the 501st registration
attempt rejected with a clear message). The cap is deliberately a simple
total, not a time-windowed rate limit — simplest durable option, and it
keeps the `count(*)` check itself cheap forever (the table can never grow
past the number being counted). A cleanup **index** on
`oauth_clients.created_at` plus a documented **pruning query** (in that
table's own SQL comment) support periodically removing clients that never
completed a flow: `delete from oauth_clients where created_at < now() -
interval '90 days' and not exists (select 1 from api_tokens where
oauth_client_id = client_id) and not exists (select 1 from oauth_codes
where client_id = oauth_clients.client_id)` — safe because of the `on
delete cascade` FKs from both tables, so it only ever removes a client with
zero issued tokens and zero pending codes. A full scheduled reaper job is
out of scope for this phase; the index + query make one easy to add later.

### The two redirect-URI predicates now agree exactly (post-review should-fix)

`lib/server/oauth.ts`'s `isAllowedRedirectUri` (real `URL` parsing) used to
be LOOSER than `oauth_redirect_uris_allowlisted` (the SQL regex, which has
no port-matching group and so rejects any `:port` outright) — a redirect_uri
with a port or userinfo could pass the app-layer pre-check and then fail at
the SQL layer with a generic `invalid_client_metadata` "Registration
failed." instead of the specific `invalid_redirect_uri` the route means to
return. Not a security hole (the SQL layer was always the stricter, winning
predicate), but the code claims these are the same check — now they
actually are: `isAllowedRedirectUri` also rejects a non-empty `port` and
any `username`/`password` (userinfo). claude.ai's real callback URLs use
neither, so this is purely an error-clarity fix.

### Consent screen shows the redirect destination (post-review should-fix, anti-phishing)

`components/oauth/AuthorizeScreen.tsx` used to name only the DCR-registered
`client_name` — a value the registering party fully controls and could set
to anything ("Official Claude Reports Sync", say). The consent card now
also shows the `redirect_uri`'s host ("Approving will send an access code
to `claude.ai`") — a value that WAS independently verified (at both
registration and authorize time) against the claude.ai/claude.com
allowlist, so a deceptive `client_name` at least gets a real counter-signal
next to it. `client_name` was already React-escaped (JSX text interpolation,
never `dangerouslySetInnerHTML`) — no XSS concern there either way.

### Discovery, not integration: GoTrue's own `auth.oauth_*` tables

The local Supabase stack's GoTrue version (2.185.0) ships its OWN native
OAuth-Authorization-Server schema (`auth.oauth_clients`,
`auth.oauth_authorizations`, `auth.oauth_consents`,
`auth.oauth_client_states`) — a *different* feature, in the `auth` schema,
unrelated to and unused by this phase. This app's `public.oauth_clients`/
`public.oauth_codes` (this migration) coexist with zero collision or
interaction (different schema, different owner, never referenced by
either). Integrating with GoTrue's native OAuth AS instead was considered
and rejected for this phase: its issued tokens are ordinary GoTrue
sessions/JWTs, not `api_tokens` rows, so wiring it in would require
changing (or bypassing) `verify_api_token`/`mcp-auth.ts` — directly against
this phase's explicit "the bridge is untouched" invariant. Worth a look in
a future phase; out of scope here.

## Project management (Phase 8c)

`supabase/migrations/20260724000011_project_management.sql` is the ONLY
schema/grant change the project-management UI (`/projects`, `/projects/[id]`)
needed. No new tables, no new columns, no `lib/types.ts` domain shape
change (list/create/rename/delete/detail-view are all served by the
EXISTING `projects` table + its EXISTING RLS policies from
`supabase/migrations/20260719000004_auth_ownership.sql`).

**LOCKED DECISION (superseding an earlier draft plan that recommended
loosening `projects_update`/`projects_delete` to all-authenticated): rename
and delete stay ADMIN-ONLY.** `projects_select`/`projects_insert` (any
authenticated user) and `projects_update`/`projects_delete`
(`public.is_admin()`) are UNCHANGED by this migration — see "Auth,
ownership, and RLS (Phase 7a)" above for their original text.

**What this migration DOES add**: a column-level privilege guard so that
even an admin (who already passes `projects_update`'s row-level
`using(is_admin())`/`with check(is_admin())`) can only ever change the
`name` column via a table UPDATE — never `id`:

```sql
revoke update on projects from authenticated;
grant update (name) on projects to authenticated;
```

`authenticated` previously held full table-level privileges on `projects`
(`authenticated=arwdDxtm/postgres` — every privilege, every column,
verified via `\dp projects` before this migration). This narrows JUST the
UPDATE privilege to the `name` column; INSERT/SELECT/DELETE privileges (and
INSERT/SELECT on every column, including `id`) are untouched. Verified
live, post-migration:

```sql
-- \dp+ projects now shows, under "Column privileges":
--   name: authenticated=w/postgres
-- and authenticated's table-level ACL entry no longer includes "w":
--   authenticated=ardDxtm/postgres
```

**Post-review SHOULD-FIX 1 — `anon` also loses its table-level grant on
`projects` entirely**:

```sql
revoke all on public.projects from anon;
```

Pre-fix, `anon` still held the Supabase-baseline full-table grant on
`projects` (`anon=arwdDxtm/postgres` — INSERT/SELECT/UPDATE/DELETE on every
column, including `id`) even though `projects` has NO `anon`-targeted RLS
policy at all — `projects_select`/`projects_insert`/`projects_update`/
`projects_delete` are every one of them `to authenticated` only, so this
was never actually reachable (RLS default-denies an unpolicied row for a
role with no matching policy). Not exploitable today, but latent risk the
moment anyone ever adds an `anon` policy here, and inconsistent with this
schema's own established "don't rely on RLS as the only gate" posture (see
`is_admin()`'s `revoke ... from public, anon` above, closing a REAL,
previously-live leak of a different function). Verified post-migration:

```sql
-- \dp+ projects: the `anon=arwdDxtm/postgres` ACL entry is GONE entirely.
-- information_schema.role_table_grants / column_privileges for
-- grantee='anon' on table_name='projects': 0 rows, either way.
```

Verified this changes NOTHING about the anon-reachable share/present-route
path: the only anon-reachable read in this whole schema is
`get_shared_report(text)` (SECURITY DEFINER, supabase/migrations/
20260719000004_auth_ownership.sql), which queries `reports`/`tasks`/`risks`
directly and never touches `public.projects` at all (each row's own
`project_id` column is returned verbatim, no join) — and a SECURITY
DEFINER function's privilege checks run against its OWNING role regardless
of the calling role's own table grants, so this revoke could not have
broken it even if it did touch `projects`. Confirmed live: enabled sharing
on a report as `dev@`, then fetched `/reports/[id]/present?t=<token>` with
zero session cookies (a fresh anonymous request) both before and after this
revoke — identical 200 response, full report content rendered either way.
Also confirmed `ensureProject`'s create path (`POST /api/projects`) is
unaffected as `member@` (non-admin, authenticated) — it always runs as
`authenticated`, which retains its unchanged SELECT/INSERT/DELETE
table-level grants (see the `authenticated=ardDxtm/postgres` ACL entry
above); `anon` was never a caller on this path.

**Verify a grant like this via `information_schema.column_privileges` /
`\dp+ <table>`, NOT `pg_proc.proacl`** — the latter is the catalog for
FUNCTION EXECUTE grants (see "Function EXECUTE grants" above), a different
catalog entirely; this migration grants a TABLE/column privilege, so
`pg_proc` has nothing to show for it. Confirmed live (local Supabase, both
via raw PostgREST and through this app's own `PATCH /api/projects/[id]`
route):

| Caller | Request | Result |
|---|---|---|
| `member@` (non-admin) | `PATCH .../projects/<id>` `{name: ...}` | RLS filters the row (`projects_update`'s `using(is_admin())` is false) → 0 rows updated, no Postgres error → curated `404 "Not found."` (not distinguished from a genuinely unknown id, same posture as `revoke_api_token`'s "not found or not permitted") |
| `dev@` (admin) | raw PostgREST `PATCH .../projects?id=eq.<id>` `{id: "hacked-id"}` | `42501 permission denied for table projects` — the column grant, not RLS, is what blocks this; an admin passes RLS but is still refused at the column-privilege layer |
| `dev@` (admin) | `PATCH .../projects/<id>` `{name: "New Name"}` | `200`, project renamed |
| `dev@` (admin) | `DELETE .../projects/<id>` on a project referenced by a task's `project_id` | `409` curated `"This project is still referenced by existing reports."` (sqlstate 23503, the `tasks_project_id_fkey`/`risks_project_id_fkey`/`reports_project_id_fkey` FK — `NO ACTION`, no cascade/set-null anywhere in this schema) |
| `dev@` (admin) | `DELETE .../projects/<id>` on an unreferenced project | `204` |
| (none) | `PATCH .../projects/<id>` with no session cookie | `401 {"error":"unauthorized"}` |

**Server layer** (`lib/server/reports-service.ts`): `renameProject(db, id,
name)` — a plain `.update({ name }).eq('id', id).select('id, name')
.maybeSingle()`; RLS/the column grant do all the enforcement, this function
just issues the call. A 23505 (`projects_name_key`, another project already
has this exact name) flows through the existing `mapPgError` → `'conflict'`
path; `curatedMessage` (`reports-service.ts`) gained one more `'conflict'`
regex branch (`projects_name_key` → "A project with this name already
exists."). `deleteProject(db, id)` — a `.delete().eq('id', id).select('id')`;
its ONE deviation from every other function in this file is that it
intercepts sqlstate 23503 itself, BEFORE calling `mapPgError` (which maps
23503 → `'invalid'`/400 for every OTHER caller, e.g. `replace_reports`
rejecting a report that names a nonexistent `project_id` — a genuinely
malformed request). A referenced project's delete being blocked is a
`'conflict'`/409 ("this can't proceed because other data depends on it"),
not a malformed request, so it can't share that blanket branch.
`curatedMessage` gained a matching `/_project_id_fkey/` regex branch
(matches whichever of the three FK constraint names fired).

**Transport schema** (`lib/schema/api.ts`): `ProjectRenameInputSchema =
z.object({ name: ProjectSchema.shape.name })` — reuses the domain schema's
own `name` field rather than redeclaring bounds, so the two can never drift.

**Repository parity** (`lib/data/reports-repository.ts` +
`local-storage-reports-repository.ts` + `http-reports-repository.ts`):
`renameProject`/`deleteProject` are explicit interface methods (not
piggybacked onto `upsertProject`, whose semantics genuinely diverge — see
that method's own doc comment). `LocalStorageReportsRepository` has no
RLS/FK to lean on, so it re-implements both rules directly: `renameProject`
throws on a missing id or an existing DIFFERENT project already holding
that exact `name`; `deleteProject` scans every locally-stored `AnyReport`
for a report/task/risk `projectId === id` reference (mirroring the SQL
FK's id-only semantics — see `lib/project-view.ts`'s `projectIsReferenced`,
which the UI uses to predict this same outcome BEFORE the request even
round-trips) and throws "still referenced" if any exist.

**THE CRUX — rename safety, restated for this section**: neither
`renameProject` implementation, nor the `PATCH /api/projects/[id]` route,
nor the app-level `resolveNewProjectName`/`renameProject`/`useProjects`
call chain, EVER touches `tasks.client`/`risks.client` or any `project_id`
FK. A rename updates exactly one column, `projects.name`. See CLAUDE.md's
"Project (client) management (Phase 8c)" → "THE CRUX" for the full
rationale (dedupe-key corruption, partial-success-under-RLS) and how the
one real, documented consequence (the dashboard's client filter, which
matched `task.client` strings against project NAMES) was fixed with an
id-or-exact-name predicate instead.

## Report delete (Phase 8d (report delete))

Weekly and daily reports can now be deleted (report screen + row-level
Dashboard/Daily-list actions). Unlike Phase 8c's project management, this
required **no `lib/types.ts`/domain shape change and no new grant for the
delete itself** — verified live against the hosted project before writing
`supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql`:

- `authenticated` already holds table-level DELETE on `reports`/`tasks`/
  `risks`/`priorities` — the Supabase-baseline grant from table creation
  (`supabase/migrations/20260717000001_initial_schema.sql`) was never
  revoked for these four tables, unlike `projects`' UPDATE privilege, which
  Phase 8c DID narrow (`20260724000011_project_management.sql`).
- `reports_delete` RLS already exists, unchanged, from
  `supabase/migrations/20260719000004_auth_ownership.sql`:
  ```sql
  create policy reports_delete on reports for delete to authenticated
    using (owner_id = (select auth.uid()) or public.is_admin());
  ```
  Owner-or-admin — the same shape as `reports_update`, not `projects_delete`
  (which is admin-only with no owner branch at all). This is what actually
  decides who can delete which report; every layer above it (the route
  handler, the service function) is a thin pass-through.
- `tasks`/`risks`/`priorities` already `references reports (id) on delete
  cascade` (same initial-schema migration, lines 82/100/116) — deleting the
  parent `reports` row removes every child row automatically. Postgres's
  referential-action cascade runs as an internal system operation, NOT as a
  second DML statement evaluated under the calling role's own privileges —
  it does not re-check `tasks_delete`/`risks_delete`/`priorities_delete` RLS
  at all (and doesn't need to: those policies are themselves scoped through
  the SAME parent `reports` row via an `exists (select 1 from reports r
  where r.id = report_id and ...)` subquery, so there is no independent
  child-level permission to re-evaluate). `lib/server/reports-service.ts`'s
  `deleteReport` therefore issues exactly ONE `DELETE FROM reports WHERE id
  = ...` and nothing else — it must never try to delete
  `tasks`/`risks`/`priorities` itself.

**Server layer** (`lib/server/reports-service.ts`): `deleteReport(db, id)` —
a `.delete().eq('id', id).select('id')`. Diverges from `deleteProject`'s
"not found and not permitted are indistinguishable" posture on purpose: a
zero-row delete triggers a follow-up `getReport(db, id)` to tell the two
apart. This is safe specifically BECAUSE `reports_select` is `using (true)`
— every authenticated user can already read every report — so returning
`'forbidden'` (curated to "You don't have permission to do that.") instead
of a blanket `'not_found'` for a report that DOES still exist leaks nothing
a plain `GET` couldn't already tell the caller, and a literal "not found"
for a report the caller is looking at on `/reports/[id]` right now would be
a straightforwardly false statement. Contrast `deleteProject`, where
`projects_select` is also `using (true))` but the distinction was never
worth making since there's no route that lands a non-admin user staring at
a project they can't delete with the same urgency a report screen's Delete
button implies.

**Share tokens**: a report's `share_token` (Phase 7b, per-report public
link) dies with the row — there is no separate revoke-before-delete step.
`get_shared_report(token)` joins against `reports`; once the row is gone,
the join returns nothing and the RPC's existing "not found" result plays
out exactly as it does for a revoked or never-enabled token. `PresentScreen`
already renders "This share link is no longer valid…" for that case — no UI
change was needed here.

**Route** (`app/api/reports/[id]/route.ts`): `DELETE`, template-copied from
`app/api/projects/[id]/route.ts`'s `DELETE` — demo-mode 404 guard,
`assertMutationAllowed` (no `requireJsonBody`, this verb takes no body),
auth check, `deleteReport`, `204` on success, `handleServiceError` on
failure (curates `deleteReport`'s `ServiceError` exactly once, same as
every other route in this file).

**Repository + hooks** (`lib/data/reports-repository.ts` +
`local-storage-reports-repository.ts` + `http-reports-repository.ts` +
`lib/hooks/useReports.ts`/`useDailyReports.ts`): `deleteReport(id)` is a new
explicit interface method on both implementations.
`LocalStorageReportsRepository`'s version has no owner/admin concept to
enforce (same posture as its `renameProject`/`deleteProject`) and no
"still referenced" concern either (nothing in this store points AT a
report by id, unlike a project) — it's a plain filter + single write,
throwing only on a missing id. Both hooks' `deleteReport` is **deliberately
NON-optimistic**, mirroring `useProjects.ts`'s `deleteProject` (Phase 8c
SHOULD-FIX 2) verbatim: the report screen's and the list rows' `notFound`/
redirect logic is derived from the SAME `reports`/`dailyReports` state this
mutates, so removing the id from state only AFTER the DELETE actually
succeeds is what keeps a failed delete from silently unmounting the screen
before its own error can render.

**UI**: `ReportScreen`'s actions row gained a fourth button, Delete
(`outline`), gated by a new `canDelete` prop computed by the route wrapper
(`app/(shell)/reports/[id]/page.tsx` / `daily/[id]/page.tsx`) —
owner-or-admin in Supabase mode (`report.ownerId === user?.id ||
user?.app_metadata?.role === 'admin'`, read via `useSession()`, matching
`reports_delete` RLS exactly), unconditionally `true` in demo mode (no
session/auth concept there — same Phase 8c precedent
`ProjectDetailScreen` established for project rename/delete). `ownerId` is
already broadcast on every `AnyReport` (`ReportCoreSchema.ownerId`) to every
authenticated user, so no read-schema change was needed to compute this
client-side. `DashboardScreen`/`DailyListScreen` gained a matching row-level
Delete button (needed because a **Draft** row's only other action is
"Continue" — without a row-level Delete, a draft was only deletable by
hand-typing its `/reports/[id]` URL). A disabled Delete button is never
hidden — it renders with a `title` hint ("Only the report's owner or an
admin can delete this report.", `lib/report-access.ts`'s
`DELETE_REPORT_HINT`, one shared string so the detail view and both list
rows can't drift on wording — it lives beside `canDeleteReport`, the single
shared owner-or-admin predicate all four call sites use, so the rule and the
sentence explaining it to the user cannot be changed independently). One shared, purely presentational
`components/dialogs/ConfirmDeleteReportDialog.tsx` renders the actual
confirm/cancel dialog for all three call sites (`ReportScreen` owns its own
open/isDeleting/error state directly, matching its existing Share-dialog
pattern; `DashboardPage`/`DailyPage` own that state at the route-
orchestrator level, since a row-level button has no per-row component to
hold it) — none of the three callers ever navigates from inside the
dialog's own confirm handler; each route's existing `notFound`-driven
redirect effect is the single place that does, after the underlying hook
state actually changes.

**Migration** (`supabase/migrations/20260724000013_reports_anon_grant_hygiene.sql`):
the ONLY schema/grant change this feature needed, and it's not required for
delete to function at all — pure grant hygiene, the same shape as Phase
8c's post-review SHOULD-FIX 1 on `projects`:
```sql
revoke all on public.reports, public.tasks, public.risks, public.priorities from anon;
```
`anon` was left holding the Supabase-baseline full-table grant (INSERT/
SELECT/UPDATE/DELETE, every column) on all four tables even though none of
them has a single `anon`-targeted RLS policy — every `reports_*`/`tasks_*`/
`risks_*`/`priorities_*` policy is `to authenticated` only, so RLS
default-denies any `anon` request regardless of these grants. **Not
exploitable today; latent risk hygiene**, described that way deliberately
(contrast `is_admin()`'s `revoke ... from public, anon` in
`20260719000004_auth_ownership.sql`, which closed a REAL, previously-
callable-over-PostgREST gap — a materially different risk class). Verified
this does not affect `get_shared_report(text)` (the only anon-reachable
read in this schema): it's SECURITY DEFINER, so it executes every internal
query with the privileges of its OWNING role regardless of the calling
role's own table grants — a table it queries losing `anon`'s DIRECT grant
cannot break a function that never queried it AS `anon` to begin with.

**Not built / explicitly out of scope**: no MCP `delete_report` tool (the
locked 8-tool contract, `lib/prompts.ts`, is deliberately unchanged — see
CLAUDE.md's "Remote MCP server (Phase 8a)" for why a bearer-token-
authenticated surface, where every token is a plain member and never
admin, doesn't get new admin-adjacent write tools without a dedicated
review of its own); no bulk/multi-select delete; no soft-delete/undo (a
report's data model has no `deleted_at` column and none was added — this
mirrors `deleteProject`'s "delete is delete" posture, not Phase 8c's
deferred project-archive idea).

## Task completion date

`supabase/migrations/20260725000014_task_completed_at.sql` adds exactly one
nullable column, `tasks.completed_at date`, so `lib/task-schedule.ts`'s
Schedule view (`/tasks?view=schedule`) can classify a task's on-time/late
delivery to the DAY when a real completion date is on record, instead of
always falling back to which WEEK a report covered it in (that fallback —
"completed-timing-unclear" when a deadline falls inside the same reporting
week a task was first marked complete — still applies, unchanged, for a
task with no `completed_at`). No other schema/domain shape changed:
`lib/schema/report.ts`'s `TaskSchema`/`TaskInputSchema` both gained
`completedAt: isoDateOrEmpty.nullish()` (the SAME `''` ↔ unset convention
`deadline` already uses, wrapped `.nullish()` — an optional key, `null`
also accepted — purely so an ALREADY-EXISTING task object, saved before
this field existed, stays valid with zero migration/backfill; see that
schema's own doc comment for why every write path THIS app controls still
normalizes an absent value to a plain `''`, matching `deadline` exactly, in
practice).

**Auto-stamped, not user-typed by default** — the single rule lives in
`lib/report-utils.ts`'s `taskCompletionStamp(current, nextStatus, today)`,
a pure function (`today` passed in, never read inside) every status-change
write path calls, directly or indirectly, so the rule cannot drift between
them:

- transitioning TO `'Complete'` with no `completedAt` already recorded ->
  stamp `today`.
- transitioning AWAY from `'Complete'` -> clear back to `''`.
- already `'Complete'` and STAYING `'Complete'` -> leave whatever is
  already there untouched (never clobbers a manual correction).

The three write paths, and how each reaches `taskCompletionStamp`:

1. **Kanban drag** (`components/tasks/KanbanBoard.tsx` -> `TaskViewScreen.
   handleTaskStatusChange` -> `withTaskStatus(report, taskId, status,
   nowDate())`, `lib/report-utils.ts`) — stamps "for free": `withTaskStatus`
   itself now takes a `today` argument and applies the rule internally, so
   the drag handler needed no new logic of its own beyond passing
   `nowDate()` through.
2. **Task modal** (`components/tasks/TaskDialog.tsx`) — its Status
   `<Select>`'s own `onChange` calls `taskCompletionStamp` directly against
   its live `completedAt`/`status` state, so the stamp/clear happens as the
   user picks a status, BEFORE Save; an editable "Completed On" date field
   renders only while Status reads `'Complete'`, prefilled from
   `entry.task.completedAt` in Edit mode, letting a PM correct the recorded
   day (reports are often written up after the fact). `withTaskEdited`
   (also given a `today` argument) applies the same rule as a fallback ONLY
   when a caller's patch changes `status` without separately supplying its
   own `completedAt` — the dialog's Save always does supply one, so this is
   defense-in-depth, not the primary path for this particular caller.
3. **Wizard Status select** (`components/wizard/steps/StepTasks.tsx` ->
   `useWizard.ts`'s `updateTask`) — branches on `field === 'status'` BEFORE
   calling the generic `updateDraftItem` (which would already have
   overwritten `status` by the time a second read could see the prior
   value), computing the new `completedAt` from the task's CURRENT
   status/completedAt in one `setDraft` call. A conditional "Completed On"
   field appears on a Complete-status wizard row (a further grid sibling
   spanning `.taskRow`'s full width, the same technique the row's Polish
   suggestion panel already uses) for the same after-the-fact correction —
   the row stays 5 columns wide for every other status, unchanged.

**CSV** (`lib/csv-templates.ts`'s `IMPORT_COLUMNS` contract, `lib/schema/
import.ts`, `lib/import.ts`): a `completed_at` column (ISO or blank) was
added to the long-format import contract, right after `deadline` — OPTIONAL
on a task row (a Complete task with a blank `completed_at` is valid; the
Schedule view's week-level fallback still applies to it). `lib/csv.ts`'s
`buildAllTasksCsv` (the flat "export all tasks" download, a separate format
from the `IMPORT_COLUMNS` contract) gained a trailing "Completed On" column
— purely additive at the end, so a consumer reading the first 9 columns by
position is unaffected.

**MCP** (`lib/server/mcp-tools.ts`): `create_report`'s task input shape
gained an optional `completed_at` (defaults `''`); `update_report` inherits
it automatically (it reuses `ReportPatchSchema`, itself built on
`ReportCoreInputSchema` -> `TaskInputSchema`, verbatim — see that tool's own
doc comment on why it alone takes camelCase). No tool was added, renamed, or
removed — `scripts/check-mcp-tool-contract.ts` still reports the same 8
names and no `delete_report`. `skills/weekly-reports/SKILL.md`'s Task-shape
section tells a connecting model never to invent or guess this value: omit
it and let the app's own auto-stamp apply, or pass the real date only if
the user explicitly states one.

**`replace_reports`** (last redefined by `20260720000006_post_review_
hardening_round2.sql`) inserts `tasks` via an EXPLICIT column list, not a
dynamic jsonb-key expansion — so this migration ALSO re-declares the whole
function (`CREATE OR REPLACE`, byte-identical to the round-2 version except
the `tasks` insert now also carries `completed_at`), or the new column
would silently never persist through the transactional write path (CSV
import, the localStorage->Supabase import, and `updateReport`'s single-row
write all go through this one function).

**Seed data** (`lib/seed.ts`): `T()` gained an optional 5th argument
(`completedAt`, omitted — not defaulted — when a caller doesn't pass one,
so every pre-existing call keeps producing a task with no `completedAt`
key at all). Exactly two already-`'Complete'` WEEKLY tasks (`r1`'s "Paid
social campaign launch", `r6`'s "Copy testing wrapped" — the Schedule view
is weekly-only, so stamping a daily-report task would demonstrate nothing)
were given a recorded `completedAt`: one a day BEFORE its deadline
(`completed-on-time`, evidence tagged "(recorded)"), one a day AFTER its
deadline (`completed-late`, evidence tagged "(recorded)") despite that
report's own period end equaling the deadline — a case the PRE-EXISTING
week-level inference alone would have called on-time, demonstrating that
the day-level path genuinely answers a question week-level inference
cannot. Every other seeded Complete task is deliberately left un-stamped,
so the Schedule view's week-level inference fallback also has real,
unaffected data to demonstrate side by side with the recorded-date path.

## Role ladder and team directory (WP0 + WP1)

**Status: both migrations below are WRITTEN but NOT APPLIED** (the user
applies migrations themselves, same posture as `20260725000014_task_completed_at.sql`).
Everything in this section describes SQL that was authored, statically
re-read end-to-end for the invariants below, and reasoned about -- not
verified live against a running database. See CLAUDE.md's "Role ladder and
team directory (WP0 + WP1)" section for the plan-level summary and what was
verified by RUNNING (the Settings Team tab, in demo mode, via a headless
browser) vs. reasoned about (the SQL itself).

### WP0 -- the role ladder (`supabase/migrations/20260726000015_role_ladder.sql`)

Two new functions, **no existing policy changed**:

- `public.role_rank(role text) returns int` -- `IMMUTABLE`. `member` = 1,
  `pm` = 2, `admin` = 3; anything else (a typo, NULL, a future/removed tier,
  the empty string) returns 1 via a `CASE ... ELSE 1 END` -- the SAME rank
  as `member`. This is the single load-bearing invariant of the whole
  ladder: an unrecognized role must degrade to the LEAST privilege, never
  error, never resolve to something higher than `member`.
- `public.has_role_at_least(required text) returns boolean` -- `STABLE`
  (reads `auth.jwt()`, so it can't be `IMMUTABLE` like `role_rank` above --
  same volatility category as `is_admin()`):
  ```sql
  select public.role_rank(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'member'))
         >= public.role_rank(required)
  ```

**`is_admin()` (supabase/migrations/20260719000004_auth_ownership.sql) is
UNCHANGED and remains the enforcement function for every existing
admin-only policy** (`projects_update`/`_delete`, and the new
`team_members_insert`/`_update`/`_delete` below) -- `has_role_at_least()`
is the SUCCESSOR a LATER package (the "RLS access flip", explicitly out of
scope for WP0/WP1) will graduate specific policies to, so they can require
"at least `pm`" instead of "exactly `admin`". Nothing in WP0/WP1 calls
`has_role_at_least()` from inside a policy yet.

Both functions get the same grant-hygiene treatment as every other function
in this schema (`revoke all ... from public, anon; grant execute ... to
authenticated;`) -- neither leaks anything sensitive on its own (both are
either a pure function of their own argument, or reveal only the caller's
own role), so this is the same defense-in-depth posture `is_admin()`'s own
identical pair documents, not the closure of a live leak.

**Client mirror**: `lib/roles.ts` -- `Role` (`'member' | 'pm' | 'admin'`),
`roleRank()`, `hasRoleAtLeast(user, required)` (reads
`user?.app_metadata?.role`, unknown/absent -> `'member'`, byte-for-byte
mirroring the SQL). Carries the identical JWT-staleness caveat
`lib/report-access.ts`'s `canDeleteReport` already documents for
`is_admin()`: a role change made via `scripts/set-user-role.mjs` only lands
in the affected user's JWT on their next token refresh (≤ 1h) -- signing
out and back in clears it immediately.

**Role assignment is out-of-band, by design.** This app never holds a
service-role credential at runtime (`lib/server/reports-service.ts`'s
header comment forbids it outright), so there is no in-app role editor.
`scripts/set-user-role.mjs <email> <member|pm|admin>` is the only way to
set `app_metadata.role` -- it looks the user up by email (paginating
`GET /auth/v1/admin/users`, since GoTrue's admin list-users endpoint
doesn't reliably support an email-filter query param across versions),
merges `{ role }` into their EXISTING `app_metadata` (never overwrites it
wholesale -- every account already carries `provider`/`providers` keys
GoTrue itself set at signup), and `PUT`s the result via
`/auth/v1/admin/users/:id`. Mirrors `scripts/create-user.mjs`'s
`.env.deploy`/service-role-key conventions exactly.

### WP1 -- the team directory (`supabase/migrations/20260726000016_team_members.sql`)

A new, standalone table:

```sql
create table team_members (
  id text primary key,
  name text not null unique,
  role text not null default 'member' check (role in ('member','pm','admin')),
  email text unique,
  user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now()
);
create index team_members_user_id_idx on team_members (user_id);
```

#### Field mapping: `team_members`

| TS field (`TeamMember`) | Column       | Type                | Notes |
| ------------------------ | ------------ | ------------------- | ----- |
| `id`                     | `id`         | `text` PK           | slug of the name (e.g. `jordan-reyes`); immutable post-create, same posture as `projects.id` |
| `name`                   | `name`       | `text`, `unique`    | display string; the ONLY column `authenticated` writes post-create (`renameTeamMember`) |
| `role`                   | `role`       | `text`, CHECK       | **directory LABEL ONLY -- see below** |
| `email`                  | `email`      | `text`, `unique`, nullable | admin-recorded; inert until matched by `link_my_team_member()` |
| `userId`                 | `user_id`    | `uuid`, `unique`, nullable, FK -> `auth.users(id)` | set ONLY by `link_my_team_member()`, never by any app write path |
| *(none)*                 | `created_at` | `timestamptz`       | not surfaced on the `TeamMember` TS type at all -- nothing in this app currently displays it |

**`team_members.role` is NOT `app_metadata.role`.** This is the single most
important thing to get right about this table, restated in three places
(this doc, the migration's own header comment, `lib/schema/team.ts`'s
header comment, and the persistent muted note in
`components/team/TeamManager.tsx`) specifically because it's easy to
conflate two same-named, same-three-values fields that mean completely
different things:

| | `team_members.role` | JWT `app_metadata.role` |
|---|---|---|
| What it is | A directory LABEL, shown next to a name | The account's ACTUAL authority |
| Who sets it | An admin, via `ensureTeamMember` at create time only -- see below | `scripts/set-user-role.mjs` only |
| What reads it for access control | **Nothing. Ever.** (grep protection: if this ever changes, it's a bug in whatever new code reads it) | `public.is_admin()` / `public.has_role_at_least()` (SQL), `lib/roles.ts` (client) |
| Can it be wrong/stale relative to the other? | Yes, by design -- see the migration's header comment for why this is accepted | N/A -- it IS the authority |

#### RLS

```sql
alter table team_members enable row level security;
create policy team_members_select on team_members for select to authenticated using (true);
create policy team_members_insert on team_members for insert to authenticated with check (public.is_admin());
create policy team_members_update on team_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy team_members_delete on team_members for delete to authenticated using (public.is_admin());
revoke all on public.team_members from anon;
```

`select` is open to any authenticated user (`using (true)`) -- a directory,
same posture as `projects_select`/`reports_select`: a later package's
assignee picker and task-card name rendering need every signed-in user to
read every row. **All three mutating verbs are admin-only** -- this is the
one place WP1's table diverges from the `projects` precedent it otherwise
clones: `projects_insert` is open to ANY authenticated user (creating a
project isn't privileged), but `team_members_insert` is admin-only, because
creating a directory row here is: linking `user_id` (via the SECURITY
DEFINER RPC below, which bypasses RLS for that one write) is effectively
priming an access grant, since a later package makes "the assignee of a
task can edit it" -- so who is even ON this directory, under what
name/email, must never be member-writable. Because insert/update/delete
are ALL already admin-only at the row level, WP1 does NOT add a
Phase-8c-style column-level grant restricting WHICH column `authenticated`
may touch (contrast `supabase/migrations/20260724000011_project_management.sql`'s
`grant update (name) on projects to authenticated` -- that existed
specifically because `projects_insert` was open to non-admins while
`projects_update` wasn't, a gap that doesn't exist here).

`revoke all on public.team_members from anon` is landed at table-CREATION
time (never even briefly missing), matching the SHOULD-FIX 1 /
`20260724000013_reports_anon_grant_hygiene.sql` hygiene posture from day
one rather than as a follow-up cleanup migration.

#### Account linking: why not a UUID paste box

This app has no service-role key at runtime, so it cannot list
`auth.users` client-side -- an admin picker over real accounts is not
buildable, and a free-typed `user_id` field would let anyone paste an
arbitrary uuid and silently grant a directory row (and, later, its
assigned tasks) to an unrelated account. A "this is me" self-claim button
has the mirror-image problem: anyone signed in could claim ANY unlinked
row, including someone else's.

The design that shipped instead:

1. An admin records the person's `email` on the directory row (independent
   of that person's actual `auth.users.email`, if they even have an
   account yet -- inert metadata until step 2 actually matches it).
2. `public.link_my_team_member() returns jsonb` -- `SECURITY DEFINER`,
   `set search_path = ''`, links the **CALLER ONLY**: it looks up the
   caller's own, Supabase-VERIFIED `auth.users.email` by `auth.uid()`
   (never a client-supplied string), then does
   `update team_members set user_id = auth.uid() where lower(email) =
   caller_email and user_id is null`. The security argument, restated:
   - `auth.uid()` is the JWT's own subject claim -- a caller can never
     influence whose uid this reads.
   - The email compared against is always the CALLER's own verified
     account email, never anyone else's.
   - `user_id is null` means an already-linked row can never be re-linked,
     which is also what makes repeated calls a safe no-op (idempotent).
   - `email unique` guarantees at most one row could ever match.
   - Together: this function can never link a caller to someone else's
     row, never re-link a row out from under whoever holds it, and never
     be used to enumerate the directory's emails (it returns a row only on
     an actual, successful link for the CALLER).
3. Called once, quietly, after sign-in (`components/app/AppShell.tsx`'s
   `useEffect`, gated on `isSupabaseConfigured()`) -- a plain
   `getSupabaseBrowserClient().rpc('link_my_team_member')`, its rejection
   swallowed. This is a convenience, not a gate: nothing in WP0/WP1 reads
   `team_members.user_id` for any access decision yet (a later package's
   assignee feature will).

Grant hygiene on `link_my_team_member()` matches every other `SECURITY
DEFINER` function in this schema (`revoke all ... from public, anon; grant
execute ... to authenticated;`).

#### Repository / service / route layer (full entity clone of Project)

- `lib/schema/team.ts` -- `TeamMemberSchema` (id/name/role/email?/userId?),
  same `.max()`-cap convention as `lib/schema/project.ts`'s `ProjectSchema`.
  Re-exported through `lib/types.ts`'s facade (`TeamMember`,
  `TeamMemberRole`) and `lib/schema/index.ts`'s barrel, exactly like
  `Project`.
- `lib/schema/api.ts` -- `TeamMemberInputSchema` (= `TeamMemberSchema`,
  no server-only fields to strip, mirroring `ProjectInputSchema`) and
  `TeamMemberRenameInputSchema` (`{ name }` only, mirroring
  `ProjectRenameInputSchema`).
- `lib/server/db-mapping.ts` -- `TeamMemberRow`, `rowToTeamMember`,
  `teamMemberToRow` (the write-side mapper deliberately NEVER emits
  `user_id` -- see its own doc comment).
- `lib/server/reports-service.ts` -- `listTeamMembers` / `ensureTeamMember`
  (insert-or-return-existing, never a rename, mirroring `ensureProject`) /
  `renameTeamMember` (name-only, mirroring `renameProject`) /
  `deleteTeamMember` (intercepts sqlstate 23503 BEFORE `mapPgError`'s
  generic mapping, mirroring `deleteProject`'s identical shape -- even
  though NO FK references `team_members` yet in this package; the
  interception is forward-declared so a later package's task-assignee FK
  needs no changes here, only a migration adding the FK itself).
  `curatedMessage` gained three new branches: `team_members_name_key` ->
  "A member with this name already exists."; `team_members_email_key` ->
  "A member with this email already exists."; a forward-declared
  `_assignee_id_fkey|_team_member_id_fkey` match -> "This member is still
  assigned to existing tasks." (unreachable today, ready for the FK a
  later package adds).
- `app/api/team/route.ts` + `app/api/team/[id]/route.ts` -- the exact
  5-step shape (demo-mode 404 -> `assertMutationAllowed` -> auth ->
  validate -> service -> `handleServiceError`) cloned from
  `app/api/projects/*`.
- `lib/data/reports-repository.ts` + both impls -- `getTeamMembers` /
  `upsertTeamMember` / `renameTeamMember` / `deleteTeamMember`.
  `LocalStorageReportsRepository` stores at `ff.team.v1`, seeded from
  `lib/seed.ts`'s `seedTeamMembers()` on first read (no `email`/`userId` on
  any seeded row -- seeding a fake, unverifiable email would defeat the
  whole point of the design above); `HttpReportsRepository` writes through
  `enqueueWrite`, same as every other write.
- `lib/hooks/useTeamMembers.ts` -- clones `useProjects.ts` exactly,
  including the optimistic + rollback pattern on `upsertTeamMember`/
  `renameTeamMember` and the deliberately NON-optimistic `deleteTeamMember`
  (a delete is terminal; a failed one should leave the row visibly present
  with a visible error, not a flash of "removed" that pops back).
- `components/team/TeamManager.tsx` (+ CSS) -- clones `ProjectsManager.tsx`'s
  self-contained-manager shape, but INLINES rename/delete into the same
  table (Team has no per-member detail route the way Projects has
  `/projects/[id]`) with the same admin-gated "disabled with a hint, never
  hidden" posture `ProjectDetailScreen.tsx` established -- extended here to
  cover Create too (see the RLS section above for why). A persistent muted
  note states the label/authority split outright: "Role here is a
  directory label. Permissions come from the account's role, which an
  admin sets outside the app." Role/email are set ONLY at creation --
  editing an existing member's role/email is out of scope for this
  package, matching `renameTeamMember`'s deliberately name-only contract.
- `lib/team.ts` -- `resolveNewTeamMemberName` (name-collision validation for
  the "New Team Member" dialog). Deliberately a SEPARATE module from
  `lib/projects.ts`'s `resolveNewProjectName`, not a shared generalization
  -- see that file's own header comment for the two reasons (scope
  creep into a file documented as Project-specific; the two entities'
  collision rules already diverge, since a team member's `email` is a
  second uniqueness axis a project has no equivalent of).
- `components/settings/SettingsScreen.tsx` -- new "Team" tab (`?tab=team`),
  between "Projects" and "Import", following the existing tab conventions.

### What was verified how

- **Static SQL re-read (not applied)**: both migration files were re-read
  end to end confirming (1) every new function has the explicit
  revoke/grant hygiene pair; (2) `role_rank` degrades every unrecognized
  input to `member`'s rank via its `CASE ... ELSE 1 END`; (3)
  `link_my_team_member()` can only ever affect the single row matching the
  CALLER's own verified email, via the three-part argument in its own
  section above; (4) RLS is enabled on `team_members` and every mutating
  policy is admin-only; (5) no EXISTING policy in either migration file was
  touched.
- **Real browser, demo mode (RUN, not just reasoned about)**: a throwaway
  CDP script drove Settings -> Team through create -> rename -> delete,
  confirming `ff.team.v1` in `localStorage` reflects each step and that a
  duplicate-name create is rejected client-side by `resolveNewTeamMemberName`
  before ever reaching the repository. See CLAUDE.md's "Role ladder and
  team directory (WP0 + WP1)" section for the transcript summary and
  screenshot paths.
- **NOT verified by running**: the Supabase-mode admin-only RLS round trip
  (a non-admin's `POST`/`PATCH`/`DELETE` against `/api/team*` actually
  returning 403/404 as curated), and `link_my_team_member()`'s live
  behavior against two real accounts. Both would need an applied migration
  against a real project, which this package deliberately does not do.

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
