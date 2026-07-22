// Lists the real auth accounts and their role-ladder role, so role changes
// aren't made against guessed/misspelled emails. Read-only: it never writes.
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from ./.env.deploy (gitignored,
// production) -- same convention as create-user.mjs / set-user-role.mjs.
//
// Usage:  node scripts/list-users.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.deploy', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const baseUrl = env.SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl) { console.error('SUPABASE_URL missing from .env.deploy'); process.exit(1); }
if (!SR) { console.error('Add SUPABASE_SERVICE_ROLE_KEY to .env.deploy (dashboard -> Settings -> API -> service_role secret).'); process.exit(1); }

const rows = [];
for (let page = 1; page <= 100; page++) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  });
  if (!res.ok) { console.error(`Failed (${res.status}):`, await res.text().catch(() => '')); process.exit(1); }
  const body = await res.json();
  const users = body.users || [];
  if (users.length === 0) break;
  for (const u of users) {
    rows.push({
      email: u.email || '(no email)',
      role: (u.app_metadata && u.app_metadata.role) || 'member (default)',
      confirmed: u.email_confirmed_at ? 'yes' : 'NO',
      lastSignIn: u.last_sign_in_at ? u.last_sign_in_at.slice(0, 10) : 'never',
    });
  }
  if (users.length < 200) break;
}

rows.sort((a, b) => a.email.localeCompare(b.email));
const wEmail = Math.max(5, ...rows.map((r) => r.email.length));
console.log(`\n${rows.length} account(s):\n`);
console.log('EMAIL'.padEnd(wEmail) + '  ROLE'.padEnd(22) + '  CONFIRMED  LAST SIGN-IN');
console.log('-'.repeat(wEmail + 2 + 22 + 2 + 9 + 2 + 12));
for (const r of rows) {
  console.log(r.email.padEnd(wEmail) + '  ' + r.role.padEnd(22) + '  ' + r.confirmed.padEnd(9) + '  ' + r.lastSignIn);
}
console.log('');
