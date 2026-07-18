// Generates supabase/seed.sql from lib/seed.ts -- run via `npx tsx
// scripts/generate-seed-sql.ts` (writes supabase/seed.sql directly; also
// prints to stdout for `git diff`-style review). supabase/seed.sql is
// GENERATED -- never hand-edit it; edit this script (or lib/seed.ts) and
// regenerate instead, or the seed can silently drift from lib/seed.ts.
//
// Phase 7a: local-only. Seeds two fixed-UUID auth.users (dev@foundationfirst.test,
// an admin, and member@foundationfirst.test, a plain member) plus the 4 seed
// projects and 12 seed reports (7 weekly + 5 daily) translated from
// lib/seed.ts, all owned by the dev admin. `position` is derived from array
// order, matching every other reads-back-ordered-by-position table in this
// schema (see docs/database-schema.md).
//
// CAVEAT (documented, not just here): raw `auth.users`/`auth.identities`
// inserts are the community-standard local-dev pattern for seeding a signed-
// in-able user, but they are NOT an official Supabase API -- a future GoTrue
// schema change could break this. Verify login E2E after every
// `supabase db reset`; if the raw insert ever breaks, the fallback is a
// post-reset script that calls the local Auth admin API instead
// (`POST {API_URL}/auth/v1/admin/users` with the service-role key). Local-
// only either way -- this file is never run against a remote project.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDailyReports, seedProjects, seedReports } from '../lib/seed';
import type { AnyReport, Priority, Risk, Task } from '../lib/types';

const DEV_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_ID = '00000000-0000-0000-0000-000000000002';
const INSTANCE_ID = '00000000-0000-0000-0000-000000000000';
const DEV_ADMIN_EMAIL = 'dev@foundationfirst.test';
const MEMBER_EMAIL = 'member@foundationfirst.test';
const LOCAL_DEV_PASSWORD = 'local-dev-password';

function str(v: string | null | undefined): string {
  if (v == null) return 'null';
  return `'${v.replace(/'/g, "''")}'`;
}

function num(v: number | null | undefined): string {
  if (v == null) return 'null';
  return String(v);
}

function userInsert(id: string, email: string, isAdmin: boolean): string {
  const appMeta = isAdmin
    ? `'{"provider":"email","providers":["email"],"role":"admin"}'::jsonb`
    : `'{"provider":"email","providers":["email"]}'::jsonb`;
  return `insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
) values (
  ${str(INSTANCE_ID)},
  ${str(id)},
  'authenticated',
  'authenticated',
  ${str(email)},
  extensions.crypt(${str(LOCAL_DEV_PASSWORD)}, extensions.gen_salt('bf')),
  now(),
  ${appMeta},
  '{}'::jsonb,
  now(), now(),
  '', '', '', '',
  false, false
) on conflict (id) do nothing;`;
}

function identityInsert(userId: string, email: string): string {
  return `insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  ${str(userId)},
  ${str(userId)},
  jsonb_build_object('sub', ${str(userId)}, 'email', ${str(email)}, 'email_verified', true),
  'email',
  now(), now(), now()
) on conflict (provider_id, provider) do nothing;`;
}

// Deterministic child ids -- `t.id`/`r.id`/`p.id` on the TS objects
// themselves are DELIBERATELY IGNORED here. lib/seed.ts mints them via
// uid() (lib/format.ts), which this same Phase 7a diff changed to
// `crypto.randomUUID()` -- so every re-run of this generator against
// seedReports()/seedDailyReports() would otherwise embed a brand-new random
// id per task/risk/priority, making the committed supabase/seed.sql
// unreproducible (verified: two consecutive runs produced completely
// different ids for all ~90 child rows) and permanently out of step with
// whatever a fresh browser's localStorage seeds at runtime. Synthesizing
// `${reportId}_t{position}` (etc.) instead is a pure function of
// (reportId, position) alone -- regenerating this file is now a genuine
// no-op when lib/seed.ts hasn't changed (enforced by `--check`, see below).
function taskValues(t: Task, reportId: string, position: number): string {
  const id = `${reportId}_t${position}`;
  return `(${str(id)}, ${str(reportId)}, ${str(t.client)}, ${str(t.projectId ?? null)}, ${str(t.task)}, ${str(t.status)}, ${str(t.deadline || null)}, ${num(position)})`;
}

function riskValues(r: Risk, reportId: string, position: number): string {
  const id = `${reportId}_rk${position}`;
  return `(${str(id)}, ${str(reportId)}, ${str(r.client)}, ${str(r.projectId ?? null)}, ${str(r.severity)}, ${str(r.description)}, ${str(r.nextStep)}, ${num(position)})`;
}

function priorityValues(p: Priority, reportId: string, position: number): string {
  const id = `${reportId}_p${position}`;
  return `(${str(id)}, ${str(reportId)}, ${str(p.text)}, ${num(position)})`;
}

function reportInsert(r: AnyReport): string {
  const weekStart = r.kind === 'weekly' ? r.weekStart : null;
  const weekEnd = r.kind === 'weekly' ? r.weekEnd : null;
  const reportDate = r.kind === 'daily' ? r.date : null;
  return `insert into reports (
  id, kind, week_start, week_end, report_date, status, prepared_for, prepared_by,
  summary_narrative, win_stat, win_label, win_narrative,
  touchpoint_calls, touchpoint_emails, touchpoint_escalations, touchpoints_narrative,
  created_at, updated_at, project_id, owner_id
) values (
  ${str(r.id)}, ${str(r.kind)}, ${str(weekStart)}, ${str(weekEnd)}, ${str(reportDate)}, ${str(r.status)},
  ${str(r.preparedFor)}, ${str(r.preparedBy)}, ${str(r.summaryNarrative)},
  ${str(r.win.stat)}, ${str(r.win.label)}, ${str(r.win.narrative)},
  ${num(r.touchpoints.calls)}, ${num(r.touchpoints.emails)}, ${num(r.touchpoints.escalations)}, ${str(r.touchpoints.narrative)},
  ${str(r.createdAt)}::timestamptz, ${str(r.updatedAt)}::timestamptz, ${str(r.projectId ?? null)}, ${str(DEV_ADMIN_ID)}
) on conflict (id) do nothing;`;
}

function childInserts(r: AnyReport): string[] {
  const out: string[] = [];
  if (r.tasks.length > 0) {
    out.push(
      `insert into tasks (id, report_id, client, project_id, task, status, deadline, position) values\n  ${r.tasks
        .map((t, i) => taskValues(t, r.id, i))
        .join(',\n  ')}\non conflict (id) do nothing;`
    );
  }
  if (r.risks.length > 0) {
    out.push(
      `insert into risks (id, report_id, client, project_id, severity, description, next_step, position) values\n  ${r.risks
        .map((rk, i) => riskValues(rk, r.id, i))
        .join(',\n  ')}\non conflict (id) do nothing;`
    );
  }
  if (r.priorities.length > 0) {
    out.push(
      `insert into priorities (id, report_id, text, position) values\n  ${r.priorities
        .map((p, i) => priorityValues(p, r.id, i))
        .join(',\n  ')}\non conflict (id) do nothing;`
    );
  }
  return out;
}

function projectInsert(): string {
  const projects = seedProjects();
  const rows = projects.map((p) => `  (${str(p.id)}, ${str(p.name)})`).join(',\n');
  return `insert into projects (id, name) values\n${rows}\non conflict (id) do nothing;`;
}

function build(): string {
  const weeklies = seedReports();
  const dailies = seedDailyReports();
  const allReports: AnyReport[] = [...weeklies, ...dailies];

  const parts: string[] = [];
  parts.push(`-- supabase/seed.sql -- GENERATED by scripts/generate-seed-sql.ts. DO NOT HAND-EDIT.
-- Regenerate with: npx tsx scripts/generate-seed-sql.ts
-- Source of truth: lib/seed.ts (seedReports/seedDailyReports/seedProjects).
--
-- Applied automatically by \`supabase start\` / \`supabase db reset\` (see
-- supabase/config.toml [db.seed]) AFTER every migration in
-- supabase/migrations/ runs, so every table/column/RLS policy referenced
-- below already exists by the time this file runs.
--
-- Seeds two fixed-UUID local auth users so RLS-as-a-different-user testing
-- is cheap (both scripts and password sign-in work, even though the app's
-- own UI is magic-link-only):
--   - dev@foundationfirst.test    (admin: raw_app_meta_data.role = 'admin')
--   - member@foundationfirst.test (plain member, no role)
-- Local dev password for BOTH: '${LOCAL_DEV_PASSWORD}'.
--
-- CAVEAT: raw auth.users/auth.identities inserts are a community-standard
-- local-dev pattern, not an official Supabase API. Verify the login E2E
-- after every \`supabase db reset\`; if a future CLI's GoTrue schema breaks
-- this insert, fall back to a post-reset script hitting the local Auth
-- admin API (POST {API_URL}/auth/v1/admin/users with the service-role key).
-- Local-only either way.

-- ---------------------------------------------------------------------------
-- Local dev users
-- ---------------------------------------------------------------------------

${userInsert(DEV_ADMIN_ID, DEV_ADMIN_EMAIL, true)}

${identityInsert(DEV_ADMIN_ID, DEV_ADMIN_EMAIL)}

${userInsert(MEMBER_ID, MEMBER_EMAIL, false)}

${identityInsert(MEMBER_ID, MEMBER_EMAIL)}

-- ---------------------------------------------------------------------------
-- Projects (lib/seed.ts seedProjects())
-- ---------------------------------------------------------------------------

${projectInsert()}

-- ---------------------------------------------------------------------------
-- Reports (7 weekly + 5 daily, lib/seed.ts seedReports()/seedDailyReports()),
-- all owned by the dev admin (owner_id = ${DEV_ADMIN_ID}).
-- ---------------------------------------------------------------------------
`);

  for (const r of allReports) {
    parts.push(`-- Report ${r.id} (${r.kind})`);
    parts.push(reportInsert(r));
    parts.push(...childInserts(r));
    parts.push('');
  }

  return parts.join('\n');
}

// `--check`: regenerate in-memory and diff against the committed file
// without writing -- exits non-zero on drift. This is the guard against
// the exact class of bug this generator just had (a silently
// unreproducible artifact): CI/a pre-commit hook can run
// `npx tsx scripts/generate-seed-sql.ts --check` and fail loudly the
// moment lib/seed.ts changes without a matching `supabase/seed.sql`
// regeneration, or if the generator itself becomes non-deterministic again.
const sql = build();
const outPath = join(__dirname, '..', 'supabase', 'seed.sql');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (existing === sql) {
    process.stdout.write(`OK: ${outPath} is up to date with lib/seed.ts (regenerating produces a zero-length diff).\n`);
    process.exit(0);
  }
  process.stderr.write(`DRIFT: ${outPath} does NOT match a fresh regeneration from lib/seed.ts. Run \`npx tsx scripts/generate-seed-sql.ts\` (no --check) and commit the result.\n`);
  process.exit(1);
}

writeFileSync(outPath, sql, 'utf8');
process.stdout.write(`Wrote ${outPath} (${sql.length} bytes)\n`);
