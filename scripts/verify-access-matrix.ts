// WP3 (the access flip): adversarial-verification harness for
// supabase/migrations/20260726000018_scoped_access.sql. Follows the same
// idiom as scripts/verify-ssrf.ts / scripts/verify-byok-providers.ts: a
// plain tsx script, explicit PASS/FAIL assertions, exit code 1 on any
// failure -- this project has no jest/vitest (see package.json's
// "scripts").
//
// Run against a LOCAL Supabase stack (never a hosted/production project --
// this script creates and deletes real rows, including auth.users):
//
//   supabase start        (if the local stack isn't already running)
//   supabase db reset     (applies every migration, including this one, +
//                          supabase/seed.sql's dev@/member@foundationfirst.test)
//   npx tsx scripts/verify-access-matrix.ts
//
// Connection info (API_URL/ANON_KEY/SERVICE_ROLE_KEY/JWT_SECRET) is read at
// runtime from `supabase status -o json` -- never hardcoded -- so this
// works whether those happen to be the well-known local "demo" defaults or
// a project-specific override.
//
// This script creates its own throwaway fixtures (two ad-hoc auth.users --
// `wp3-verify-b@`/`wp3-verify-pm@foundationfirst.test` -- a team_members
// row, reports/tasks/dailies, and one api_tokens row, all id-prefixed
// `wp3v-`) and deletes every one of them in a `finally` block, using the
// SERVICE ROLE key (which bypasses RLS) for cleanup -- safe to re-run any
// number of times against the same local stack; a crashed prior run's
// leftovers are also cleaned up by the SAME delete-by-prefix calls at the
// START of `main()`, before fixtures are (re)created.
//
// **Player roles** (matching the locked permission matrix in the migration
// header comment):
//   - A = the existing seeded `member@foundationfirst.test` (plain member,
//     no `app_metadata.role`) -- owns `wp3v-r-a` (weekly) and its tasks.
//   - B = a freshly-created plain member (`wp3-verify-b@...`) -- owns
//     `wp3v-r-b`; is the ASSIGNEE of one task on A's report
//     (`wp3v-t-assigned`), and NOT the assignee of a second task on the
//     same report (`wp3v-t-unassigned`).
//   - PM = a freshly-created member with `app_metadata.role = 'pm'`
//     (`wp3-verify-pm@...`).
//   - ADMIN = the existing seeded `dev@foundationfirst.test`
//     (`app_metadata.role = 'admin'`).
//
// **Scope, stated precisely**: every check below hits Postgres/PostgREST
// DIRECTLY (raw REST/RPC calls, real signed-in sessions, and one
// self-minted HS256 JWT mirroring `lib/server/mcp-auth.ts`'s `mintMcpJwt`
// for the org-read-scope check) -- this is the actual security boundary,
// and it's what "confirm each policy transcribes the matrix exactly" means.
// It does NOT start this app's own Next dev server, so it cannot exercise
// the CURATED error strings `curatedMessage`/`handleServiceError`
// (lib/server/reports-service.ts, route-helpers.ts) produce -- those are an
// app-layer translation OVER whatever raw Postgres/PostgREST response this
// script asserts on (an empty result set, a 42501/409-shaped error, etc.).
// Where the app's real write path goes through a specific RPC
// (`replace_reports`, for `updateReport`) rather than a plain table PATCH,
// this script calls THAT RPC directly so the assertion matches what the
// app itself actually does, not just the underlying table-level policy.

import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// =============================================================================
// Connection info
// =============================================================================

interface StatusJson {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
}

function getStatus(): StatusJson {
  let raw: string;
  try {
    raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  } catch (err) {
    console.error('FAIL: could not run `supabase status -o json` -- is a local Supabase stack running? (`supabase start`, then `supabase db reset`)');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  // Some CLI versions print an "update available" nag line before the JSON
  // -- find the object explicitly rather than assuming stdout is pure JSON.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.error(`FAIL: could not find JSON in \`supabase status -o json\` output:\n${raw}`);
    process.exit(1);
  }
  return JSON.parse(raw.slice(start, end + 1)) as StatusJson;
}

const status = getStatus();
const API_URL = status.API_URL;
const ANON_KEY = status.ANON_KEY;
const SERVICE_KEY = status.SERVICE_ROLE_KEY;
const JWT_SECRET = status.JWT_SECRET;

// =============================================================================
// PASS/FAIL bookkeeping
// =============================================================================

let passed = 0;
let failed = 0;

function ok(label: string, detail?: string): void {
  passed += 1;
  console.log(`OK:   ${label}${detail ? ` -- ${detail}` : ''}`);
}
function fail(label: string, detail?: string): void {
  failed += 1;
  console.error(`FAIL: ${label}${detail ? ` -- ${detail}` : ''}`);
}
function expect(condition: boolean, label: string, detail?: string): void {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

// =============================================================================
// HTTP helpers
// =============================================================================

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function adminCreateUser(email: string, password: string, appMetadata: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: appMetadata }),
  });
  const body = (await json(res)) as { id?: string; msg?: string; error_description?: string; message?: string };
  if (!res.ok) throw new Error(`adminCreateUser(${email}) failed: ${res.status} ${JSON.stringify(body)}`);
  if (!body.id) throw new Error(`adminCreateUser(${email}) returned no id: ${JSON.stringify(body)}`);
  return body.id;
}

async function adminDeleteUser(id: string): Promise<void> {
  await fetch(`${API_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

async function signIn(email: string, password: string): Promise<{ userId: string; token: string }> {
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await json(res)) as { user?: { id: string }; access_token?: string };
  if (!res.ok || !body.access_token || !body.user) throw new Error(`signIn(${email}) failed: ${res.status} ${JSON.stringify(body)}`);
  return { userId: body.user.id, token: body.access_token };
}

interface RestResult {
  status: number;
  body: unknown;
}

/** `token` omitted = a genuinely anonymous (anon-role) call -- no Authorization header at all, matching `lib/supabase/anon.ts`'s bare client. `asService` = the service-role key on BOTH `apikey` and `Authorization` (bypasses RLS entirely) -- fixture setup/teardown only, never a "caller" in an assertion. */
async function rest(path: string, opts: { token?: string; asService?: boolean; method?: string; body?: unknown; prefer?: string } = {}): Promise<RestResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.asService) {
    headers.apikey = SERVICE_KEY;
    headers.Authorization = `Bearer ${SERVICE_KEY}`;
  } else {
    headers.apikey = ANON_KEY;
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.prefer) headers.Prefer = opts.prefer;
  const res = await fetch(`${API_URL}/rest/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await json(res) };
}

// =============================================================================
// The MCP JWT bridge, mirrored (mints an HS256 token exactly like
// lib/server/mcp-auth.ts's mintMcpJwt) -- used ONLY to prove the org-read
// scope's actual widening effect end to end, the same way a real MCP tool
// call would exercise it. Duplicated here deliberately (a verification
// script has no business importing app server code that itself asserts
// `SUPABASE_JWT_SECRET` is set via env) -- kept intentionally tiny.
// =============================================================================

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintTestJwt(userId: string, orgRead: boolean): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${API_URL}/auth/v1`,
    iat,
    exp: iat + 300,
    org_read: orgRead,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// =============================================================================
// Fixture ids -- everything this script creates is prefixed `wp3v-` (rows)
// or `wp3-verify-...@foundationfirst.test` (users), so setup/teardown can
// find everything by prefix without tracking a separate manifest.
// =============================================================================

const R_A = 'wp3v-r-a';
const R_B = 'wp3v-r-b';
const T_ASSIGNED = 'wp3v-t-assigned';
const T_UNASSIGNED = 'wp3v-t-unassigned';
const D_A1 = 'wp3v-d-a1';
const D_A2 = 'wp3v-d-a2';
const D_B1 = 'wp3v-d-b1';
const D_B2 = 'wp3v-d-b2';
const TM_B = 'wp3v-tm-b';
const TOKEN_ROW = 'wp3v-tok';
const DAILY_DATE = '2026-08-03';

const EMAIL_B = 'wp3-verify-b@foundationfirst.test';
const EMAIL_PM = 'wp3-verify-pm@foundationfirst.test';
const PASSWORD = 'wp3-verify-password';

// dev@/member@foundationfirst.test are seeded with fixed UUIDs and this
// exact password by supabase/seed.sql -- see that file's own header comment.
const EMAIL_A = 'member@foundationfirst.test';
const EMAIL_ADMIN = 'dev@foundationfirst.test';
const SEED_PASSWORD = 'local-dev-password';

async function deleteFixtureRows(): Promise<void> {
  await rest(`/reports?id=in.(${[R_A, R_B, D_A1, D_A2, D_B1, D_B2].join(',')})`, { asService: true, method: 'DELETE' });
  await rest(`/team_members?id=eq.${TM_B}`, { asService: true, method: 'DELETE' });
  await rest(`/api_tokens?id=eq.${TOKEN_ROW}`, { asService: true, method: 'DELETE' });
}

async function deleteFixtureUsers(): Promise<void> {
  // Look up by email (ids are freshly minted each run) rather than tracking
  // them across a crashed prior run.
  const res = await fetch(`${API_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const body = (await json(res)) as { users?: { id: string; email: string }[] };
  for (const u of body.users ?? []) {
    if (u.email === EMAIL_B || u.email === EMAIL_PM) await adminDeleteUser(u.id);
  }
}

async function main(): Promise<void> {
  console.log(`Target: ${API_URL}\n`);

  console.log('=== Cleanup any leftovers from a previous/crashed run ===');
  await deleteFixtureRows();
  await deleteFixtureUsers();

  console.log('\n=== Fixture setup ===');
  const a = await signIn(EMAIL_A, SEED_PASSWORD);
  const admin = await signIn(EMAIL_ADMIN, SEED_PASSWORD);
  await adminCreateUser(EMAIL_B, PASSWORD, {});
  await adminCreateUser(EMAIL_PM, PASSWORD, { role: 'pm' });
  const b = await signIn(EMAIL_B, PASSWORD);
  const pm = await signIn(EMAIL_PM, PASSWORD);
  console.log(`  A (member@) = ${a.userId}`);
  console.log(`  ADMIN (dev@) = ${admin.userId}`);
  console.log(`  B (fresh member) = ${b.userId}`);
  console.log(`  PM (fresh pm) = ${pm.userId}`);

  // team_members row for B, admin-created (team_members_insert is
  // admin-only), then B self-links via link_my_team_member() -- the exact
  // WP1 flow this app's own AppShell runs quietly after sign-in.
  const tmInsert = await rest('/team_members', {
    token: admin.token,
    method: 'POST',
    body: { id: TM_B, name: 'WP3 Verify B', role: 'member', email: EMAIL_B },
  });
  expect(tmInsert.status === 201 || tmInsert.status === 200, 'fixture: admin creates team_members row for B', `status ${tmInsert.status}`);
  const link = await rest('/rpc/link_my_team_member', { token: b.token, method: 'POST', body: {} });
  expect(link.status === 200, 'fixture: B self-links via link_my_team_member()', `status ${link.status} body ${JSON.stringify(link.body)}`);

  const now = new Date().toISOString();
  const rInsert = await rest('/reports', {
    token: a.token,
    method: 'POST',
    body: {
      id: R_A,
      kind: 'weekly',
      week_start: '2026-08-03',
      week_end: '2026-08-07',
      status: 'Draft',
      prepared_for: 'WP3 Verify',
      prepared_by: 'A',
      created_at: now,
      updated_at: now,
      owner_id: a.userId,
    },
  });
  expect(rInsert.status === 201, 'fixture: A creates report wp3v-r-a', `status ${rInsert.status} body ${JSON.stringify(rInsert.body)}`);

  const rBInsert = await rest('/reports', {
    token: b.token,
    method: 'POST',
    body: {
      id: R_B,
      kind: 'weekly',
      week_start: '2026-08-03',
      week_end: '2026-08-07',
      status: 'Draft',
      prepared_for: 'WP3 Verify',
      prepared_by: 'B',
      created_at: now,
      updated_at: now,
      owner_id: b.userId,
    },
  });
  expect(rBInsert.status === 201, 'fixture: B creates report wp3v-r-b', `status ${rBInsert.status} body ${JSON.stringify(rBInsert.body)}`);

  const tAssigned = await rest('/tasks', {
    token: a.token,
    method: 'POST',
    body: { id: T_ASSIGNED, report_id: R_A, client: 'Acme', task: 'Assigned to B', status: 'In Progress', position: 0, assignee_id: TM_B },
  });
  expect(tAssigned.status === 201, 'fixture: A creates task assigned to B', `status ${tAssigned.status} body ${JSON.stringify(tAssigned.body)}`);

  const tUnassigned = await rest('/tasks', {
    token: a.token,
    method: 'POST',
    body: { id: T_UNASSIGNED, report_id: R_A, client: 'Acme', task: 'Unassigned', status: 'In Progress', position: 1 },
  });
  expect(tUnassigned.status === 201, 'fixture: A creates an unassigned task', `status ${tUnassigned.status} body ${JSON.stringify(tUnassigned.body)}`);

  try {
    // =========================================================================
    // 1) B cannot select A's reports -- empty result, not an error.
    // =========================================================================
    const bSeesRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: b.token });
    expect(bSeesRA.status === 200 && Array.isArray(bSeesRA.body) && bSeesRA.body.length === 0, "B's SELECT on A's report returns empty (not an error)", `status ${bSeesRA.status} rows ${JSON.stringify(bSeesRA.body)}`);

    // =========================================================================
    // 2) B's list_assigned_tasks returns exactly B's assigned task(s).
    // =========================================================================
    const bAssigned = await rest('/rpc/list_assigned_tasks', { token: b.token, method: 'POST', body: {} });
    const bAssignedIds = Array.isArray(bAssigned.body) ? (bAssigned.body as { id: string }[]).map((t) => t.id) : [];
    expect(
      bAssigned.status === 200 && bAssignedIds.includes(T_ASSIGNED) && !bAssignedIds.includes(T_UNASSIGNED),
      "B's list_assigned_tasks() includes the assigned task and excludes the unassigned one",
      `status ${bAssigned.status} ids ${JSON.stringify(bAssignedIds)}`
    );

    // =========================================================================
    // 3) B's update_assigned_task on the assigned task succeeds AND bumps
    //    the parent report's updated_at.
    // =========================================================================
    const rABefore = await rest(`/reports?id=eq.${R_A}&select=updated_at`, { asService: true });
    const beforeUpdatedAt = Array.isArray(rABefore.body) ? (rABefore.body[0] as { updated_at: string })?.updated_at : undefined;

    const bUpdate = await rest('/rpc/update_assigned_task', {
      token: b.token,
      method: 'POST',
      body: { p_task_id: T_ASSIGNED, p_status: 'Complete', p_deadline: null, p_completed_at: null },
    });
    const bUpdateBody = bUpdate.body as { task?: { status?: string }; reportId?: string; updatedAt?: string } | null;
    expect(
      bUpdate.status === 200 && bUpdateBody?.task?.status === 'Complete' && bUpdateBody?.reportId === R_A,
      "B's update_assigned_task() on the assigned task succeeds",
      `status ${bUpdate.status} body ${JSON.stringify(bUpdate.body)}`
    );

    const rAAfter = await rest(`/reports?id=eq.${R_A}&select=updated_at`, { asService: true });
    const afterUpdatedAt = Array.isArray(rAAfter.body) ? (rAAfter.body[0] as { updated_at: string })?.updated_at : undefined;
    expect(
      Boolean(beforeUpdatedAt) && Boolean(afterUpdatedAt) && afterUpdatedAt !== beforeUpdatedAt,
      "update_assigned_task() bumped the parent report's updated_at",
      `before ${beforeUpdatedAt} after ${afterUpdatedAt}`
    );

    // =========================================================================
    // 4) B on a non-assigned task -> denied.
    // =========================================================================
    const bDenied = await rest('/rpc/update_assigned_task', {
      token: b.token,
      method: 'POST',
      body: { p_task_id: T_UNASSIGNED, p_status: 'Complete', p_deadline: null, p_completed_at: null },
    });
    expect(bDenied.status >= 400, "B's update_assigned_task() on a NON-assigned task is denied", `status ${bDenied.status} body ${JSON.stringify(bDenied.body)}`);

    // =========================================================================
    // 5) admin (and pm) read all.
    // =========================================================================
    const adminSeesRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: admin.token });
    expect(adminSeesRA.status === 200 && Array.isArray(adminSeesRA.body) && adminSeesRA.body.length === 1, "admin's SELECT sees A's report", `status ${adminSeesRA.status} rows ${JSON.stringify(adminSeesRA.body)}`);
    const pmSeesRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: pm.token });
    expect(pmSeesRA.status === 200 && Array.isArray(pmSeesRA.body) && pmSeesRA.body.length === 1, "pm's SELECT sees A's report", `status ${pmSeesRA.status} rows ${JSON.stringify(pmSeesRA.body)}`);

    // =========================================================================
    // 6) admin PATCH of A's report -> denied. Two layers, matching the app's
    //    ACTUAL write path (replace_reports RPC, SECURITY INVOKER) as well
    //    as the raw table-level PATCH a direct PostgREST client might issue.
    // =========================================================================
    const adminReplaceReports = await rest('/rpc/replace_reports', {
      token: admin.token,
      method: 'POST',
      body: {
        payload: [
          {
            id: R_A,
            kind: 'weekly',
            week_start: '2026-08-03',
            week_end: '2026-08-07',
            status: 'Final',
            prepared_for: 'Hacked by admin',
            prepared_by: 'A',
            summary_narrative: '',
            win_stat: '',
            win_label: '',
            win_narrative: '',
            touchpoint_calls: 0,
            touchpoint_emails: 0,
            touchpoint_escalations: 0,
            touchpoints_narrative: '',
            created_at: now,
            updated_at: now,
            project_id: null,
            tasks: [],
            risks: [],
            priorities: [],
          },
        ],
        skip_existing: false,
      },
    });
    expect(
      adminReplaceReports.status >= 400,
      "admin's replace_reports() (the app's real write path) on A's report is denied -- this is what the app curates to \"You don't have permission to do that.\"",
      `status ${adminReplaceReports.status} body ${JSON.stringify(adminReplaceReports.body)}`
    );

    const adminRawPatch = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, {
      token: admin.token,
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status: 'Final' },
    });
    expect(
      Array.isArray(adminRawPatch.body) && adminRawPatch.body.length === 0,
      "admin's raw table-level PATCH on A's report silently updates ZERO rows (RLS-filtered, no error at this layer)",
      `status ${adminRawPatch.status} body ${JSON.stringify(adminRawPatch.body)}`
    );
    const stillDraft = await rest(`/reports?id=eq.${R_A}&select=status`, { asService: true });
    const stillDraftStatus = Array.isArray(stillDraft.body) ? (stillDraft.body[0] as { status: string })?.status : undefined;
    expect(stillDraftStatus === 'Draft', "A's report status is genuinely unchanged after admin's denied PATCH attempts", `status is now "${stillDraftStatus}"`);

    // =========================================================================
    // 7) raw PostgREST PATCH /tasks?id=eq.<A's task> as B -> 0 rows (B is
    //    neither the parent report's owner nor this task's assignee).
    // =========================================================================
    const bPatchTask = await rest(`/tasks?id=eq.${T_UNASSIGNED}`, {
      token: b.token,
      method: 'PATCH',
      prefer: 'return=representation',
      body: { task: 'hacked' },
    });
    expect(Array.isArray(bPatchTask.body) && bPatchTask.body.length === 0, "raw PostgREST PATCH /tasks as B on a task she doesn't own/isn't assigned to -> 0 rows", `status ${bPatchTask.status} body ${JSON.stringify(bPatchTask.body)}`);

    // =========================================================================
    // 8) anon EXECUTE on both new RPCs -> denied.
    // =========================================================================
    const anonList = await rest('/rpc/list_assigned_tasks', { method: 'POST', body: {} });
    expect(anonList.status >= 400, 'anon EXECUTE on list_assigned_tasks() -> denied', `status ${anonList.status} body ${JSON.stringify(anonList.body)}`);
    const anonUpdate = await rest('/rpc/update_assigned_task', { method: 'POST', body: { p_task_id: T_ASSIGNED, p_status: null, p_deadline: null, p_completed_at: null } });
    expect(anonUpdate.status >= 400, 'anon EXECUTE on update_assigned_task() -> denied', `status ${anonUpdate.status} body ${JSON.stringify(anonUpdate.body)}`);
    const anonOrgRead = await rest('/rpc/token_has_org_read', { method: 'POST', body: {} });
    expect(anonOrgRead.status >= 400, 'anon EXECUTE on token_has_org_read() -> denied', `status ${anonOrgRead.status} body ${JSON.stringify(anonOrgRead.body)}`);

    // =========================================================================
    // 9) verify_api_token IS anon-callable by design (the MCP bridge calls
    //    it via the bare anon client) -- garbage token -> null; a real,
    //    freshly-hashed token -> its {user_id, org_read}.
    // =========================================================================
    const anonVerifyGarbage = await rest('/rpc/verify_api_token', { method: 'POST', body: { p_token: 'not-a-real-token' } });
    expect(anonVerifyGarbage.status === 200 && anonVerifyGarbage.body === null, 'anon-callable verify_api_token() returns null for a garbage token (not denied -- it IS anon-reachable by design)', `status ${anonVerifyGarbage.status} body ${JSON.stringify(anonVerifyGarbage.body)}`);

    const plaintextToken = 'ffmcp_wp3-verify-token-value';
    const tokenHash = sha256Hex(plaintextToken);
    const tokenInsert = await rest('/api_tokens', {
      asService: true,
      method: 'POST',
      body: { id: TOKEN_ROW, user_id: b.userId, token_hash: tokenHash, label: 'wp3 verify', org_read: true },
    });
    expect(tokenInsert.status === 201, 'fixture: service-role creates an api_tokens row (org_read: true) for B', `status ${tokenInsert.status} body ${JSON.stringify(tokenInsert.body)}`);

    const anonVerifyReal = await rest('/rpc/verify_api_token', { method: 'POST', body: { p_token: plaintextToken } });
    const verifyBody = anonVerifyReal.body as { user_id?: string; org_read?: boolean } | null;
    expect(
      anonVerifyReal.status === 200 && verifyBody?.user_id === b.userId && verifyBody?.org_read === true,
      "verify_api_token() returns {user_id, org_read} for a real token, matching the row's own org_read flag",
      `status ${anonVerifyReal.status} body ${JSON.stringify(anonVerifyReal.body)}`
    );

    // =========================================================================
    // 10) The org-read scope claim, end to end -- mint the SAME shape of
    //     JWT lib/server/mcp-auth.ts's mintMcpJwt would for this token
    //     (org_read: true, no app_metadata), and confirm it (a) can now
    //     read A's report despite being B, a plain member who does not own
    //     it, and (b) STILL cannot write to it -- org-read only ever
    //     widens SELECT, never INSERT/UPDATE/DELETE.
    // =========================================================================
    const bOrgReadJwt = mintTestJwt(b.userId, true);
    const orgReadSeesRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: bOrgReadJwt });
    expect(
      orgReadSeesRA.status === 200 && Array.isArray(orgReadSeesRA.body) && orgReadSeesRA.body.length === 1,
      "B's org-read-scoped JWT (org_read: true) CAN now read A's report",
      `status ${orgReadSeesRA.status} rows ${JSON.stringify(orgReadSeesRA.body)}`
    );
    const orgReadPatchRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, {
      token: bOrgReadJwt,
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status: 'Final' },
    });
    expect(
      Array.isArray(orgReadPatchRA.body) && orgReadPatchRA.body.length === 0,
      "B's org-read-scoped JWT still CANNOT write to A's report (org_read never widens write authority)",
      `status ${orgReadPatchRA.status} body ${JSON.stringify(orgReadPatchRA.body)}`
    );
    // A plain (non-org-read) JWT for B must NOT see A's report -- confirms
    // the widening is genuinely conditional on the claim, not a general
    // regression of check #1 above.
    const bPlainJwt = mintTestJwt(b.userId, false);
    const plainSeesRA = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: bPlainJwt });
    expect(
      plainSeesRA.status === 200 && Array.isArray(plainSeesRA.body) && plainSeesRA.body.length === 0,
      "B's PLAIN (org_read: false) minted JWT still cannot read A's report",
      `status ${plainSeesRA.status} rows ${JSON.stringify(plainSeesRA.body)}`
    );

    // =========================================================================
    // 11) admin DELETE of A's report -> succeeds (pm+ can delete ANY
    //     report, per the matrix -- this deliberately runs near the end,
    //     since it cascades away wp3v-r-a's tasks).
    // =========================================================================
    const adminDelete = await rest(`/reports?id=eq.${R_A}&select=id,status,owner_id`, { token: admin.token, method: 'DELETE', prefer: 'return=representation' });
    expect(Array.isArray(adminDelete.body) && adminDelete.body.length === 1, "admin's DELETE of A's report succeeds", `status ${adminDelete.status} body ${JSON.stringify(adminDelete.body)}`);

    // =========================================================================
    // 12) One daily per (owner, project bucket, day) -- A and B can each
    //     file a daily for the SAME date, and a SECOND one each conflicts.
    // =========================================================================
    const aDaily1 = await rest('/reports', {
      token: a.token,
      method: 'POST',
      body: { id: D_A1, kind: 'daily', report_date: DAILY_DATE, status: 'Draft', prepared_for: 'X', prepared_by: 'A', created_at: now, updated_at: now, owner_id: a.userId },
    });
    expect(aDaily1.status === 201, "A's first daily for the date succeeds", `status ${aDaily1.status} body ${JSON.stringify(aDaily1.body)}`);

    const aDaily2 = await rest('/reports', {
      token: a.token,
      method: 'POST',
      body: { id: D_A2, kind: 'daily', report_date: DAILY_DATE, status: 'Draft', prepared_for: 'X', prepared_by: 'A', created_at: now, updated_at: now, owner_id: a.userId },
    });
    expect(aDaily2.status === 409, "A's SECOND daily for the SAME date conflicts (409)", `status ${aDaily2.status} body ${JSON.stringify(aDaily2.body)}`);
    expect(JSON.stringify(aDaily2.body).includes('reports_one_daily_per_day'), "the conflict names the reports_one_daily_per_day constraint (what curatedMessage pattern-matches)", JSON.stringify(aDaily2.body));

    const bDaily1 = await rest('/reports', {
      token: b.token,
      method: 'POST',
      body: { id: D_B1, kind: 'daily', report_date: DAILY_DATE, status: 'Draft', prepared_for: 'X', prepared_by: 'B', created_at: now, updated_at: now, owner_id: b.userId },
    });
    expect(bDaily1.status === 201, "B's daily for the SAME date as A's succeeds (different owner bucket)", `status ${bDaily1.status} body ${JSON.stringify(bDaily1.body)}`);

    const bDaily2 = await rest('/reports', {
      token: b.token,
      method: 'POST',
      body: { id: D_B2, kind: 'daily', report_date: DAILY_DATE, status: 'Draft', prepared_for: 'X', prepared_by: 'B', created_at: now, updated_at: now, owner_id: b.userId },
    });
    expect(bDaily2.status === 409, "B's SECOND daily for the SAME date conflicts (409)", `status ${bDaily2.status} body ${JSON.stringify(bDaily2.body)}`);
  } finally {
    console.log('\n=== Teardown ===');
    await deleteFixtureRows();
    await deleteFixtureUsers();
    console.log('  fixture rows + users removed.');
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

void main();
