// Creates a confirmed user (email + password) on the hosted Supabase project,
// for the admin-created-accounts model -- no confirmation email is sent, the
// user can sign in immediately. Optionally marks them admin (app_metadata.role
// = 'admin', which public.is_admin() reads). Uses the SERVICE ROLE key, which
// is an admin-only credential -- it lives ONLY in ./.env.deploy (gitignored)
// and is never used by the app itself.
//
// One-time setup: add to .env.deploy
//   SUPABASE_SERVICE_ROLE_KEY=<Supabase dashboard -> Settings -> API -> service_role secret>
//
// Usage:
//   node scripts/create-user.mjs <email> <password> [--admin]
// Example:
//   node scripts/create-user.mjs nadia@paretotalent.com 'a-strong-password' --admin
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.deploy', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL) { console.error('SUPABASE_URL missing from .env.deploy'); process.exit(1); }
if (!SR) { console.error('Add SUPABASE_SERVICE_ROLE_KEY to .env.deploy\n  (Supabase dashboard -> Settings -> API -> "service_role" secret -- the admin key, keep it out of git).'); process.exit(1); }

const [email, password, ...flags] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: node scripts/create-user.mjs <email> <password> [--admin]'); process.exit(1); }
const admin = flags.includes('--admin');

const res = await fetch(`${URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true, app_metadata: admin ? { role: 'admin' } : {} }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Failed (${res.status}):`, body?.msg || body?.error_description || body?.message || JSON.stringify(body));
  console.error('(A 422 "email address ... already been registered" means the account already exists.)');
  process.exit(1);
}
console.log(`Created ${email}${admin ? '  [admin]' : ''} -- confirmed. They can sign in with email + password now.`);
