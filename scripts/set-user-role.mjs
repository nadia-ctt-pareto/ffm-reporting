// Sets a signed-up user's role-ladder authority (member | pm | admin) by
// writing `app_metadata.role` via the Supabase Admin API -- the ONLY way to
// change a user's authority in this app. There is deliberately no in-app
// role editor: this app never holds a service-role credential at runtime
// (see lib/server/reports-service.ts's header comment -- every server-side
// function in this codebase is explicitly forbidden from ever being handed
// one), so role assignment is necessarily an out-of-band, operator-run
// script -- same posture as scripts/create-user.mjs, which this script
// mirrors line-for-line for its .env.deploy/service-role-key conventions.
//
// `app_metadata` (not `user_metadata`) is what supabase/migrations/
// 20260726000015_role_ladder.sql's `has_role_at_least()`/`is_admin()` read
// -- it's server-set only and cannot be forged by the user themselves, which
// is exactly why every RLS policy in this schema that checks role trusts it.
//
// A role change lands in the affected user's JWT on their NEXT token
// refresh (<= 1h) -- signing out and back in makes it apply immediately.
// See lib/roles.ts's hasRoleAtLeast() and supabase/migrations/
// 20260719000004_auth_ownership.sql's is_admin() comment for the identical
// staleness caveat this shares.
//
// One-time setup: add to .env.deploy (same keys create-user.mjs already needs)
//   SUPABASE_URL=<your project's REST URL, e.g. https://xyz.supabase.co>
//   SUPABASE_SERVICE_ROLE_KEY=<Supabase dashboard -> Settings -> API -> service_role secret>
//
// Usage:
//   node scripts/set-user-role.mjs <email> <member|pm|admin>
// Example:
//   node scripts/set-user-role.mjs jordan@foundationfirst.com pm
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.deploy', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const baseUrl = env.SUPABASE_URL; // NOT `URL` -- shadows the global URL constructor used below (see create-user.mjs's identical note)
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl) { console.error('SUPABASE_URL missing from .env.deploy'); process.exit(1); }
if (!SR) { console.error('Add SUPABASE_SERVICE_ROLE_KEY to .env.deploy\n  (Supabase dashboard -> Settings -> API -> "service_role" secret -- the admin key, keep it out of git).'); process.exit(1); }

const VALID_ROLES = ['member', 'pm', 'admin'];
const [email, role] = process.argv.slice(2);
if (!email || !role) { console.error('Usage: node scripts/set-user-role.mjs <email> <member|pm|admin>'); process.exit(1); }
if (!VALID_ROLES.includes(role)) { console.error(`Role must be one of: ${VALID_ROLES.join(', ')} (got "${role}").`); process.exit(1); }

// GoTrue's admin "list users" endpoint doesn't reliably support a plain
// email-filter query param across versions, so this scans pages of the
// full user list and matches client-side -- fine at "a handful of PMs at
// one agency" scale, and avoids depending on undocumented server behavior.
async function findUserByEmail(target) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Failed to list users (${res.status}): ${body?.msg || body?.error_description || JSON.stringify(body)}`);
    }
    const users = body?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (match) return match;
    if (users.length < perPage) return null; // last page reached, no match
  }
  return null; // safety cap -- 50 * 200 = 10,000 users is far beyond this app's real scale
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`No user found with email ${email} -- create them first with scripts/create-user.mjs.`);
  process.exit(1);
}

// Merge into the user's EXISTING app_metadata -- never overwrite it
// wholesale. Every account already carries provider/providers keys GoTrue
// itself set at signup (see scripts/generate-seed-sql.ts's userInsert() for
// the shape); blowing those away to set one key would be an unrelated
// regression.
const nextAppMetadata = { ...(user.app_metadata ?? {}), role };

const updateRes = await fetch(`${baseUrl}/auth/v1/admin/users/${user.id}`, {
  method: 'PUT',
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_metadata: nextAppMetadata }),
});
const updateBody = await updateRes.json().catch(() => ({}));
if (!updateRes.ok) {
  console.error(`Failed to update ${email} (${updateRes.status}):`, updateBody?.msg || updateBody?.error_description || JSON.stringify(updateBody));
  process.exit(1);
}
console.log(`Set ${email}'s role to '${role}'. Takes effect on their next token refresh (<= 1h) -- sign out/in to apply it immediately.`);
