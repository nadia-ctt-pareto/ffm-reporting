// Confirms the Production environment variables the app needs are set on the
// Vercel project, and prints the latest production deployment state. Reads the
// Vercel token from ./.env.deploy (gitignored). Read-only -- lists env var
// KEYS + targets only, never decrypts values.
//
// Usage:  node scripts/check-vercel-env.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.deploy', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const VT = env.VERCEL_TOKEN;
if (!VT) { console.error('VERCEL_TOKEN not found in .env.deploy'); process.exit(1); }

const H = { Authorization: `Bearer ${VT}` };
const api = async (p) => {
  const r = await fetch(`https://api.vercel.com${p}`, { headers: H });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
};

const EXPECT = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET', 'AI_BYOK_ENCRYPTION_KEY'];
const NAME = 'ffm-reporting';

// scopes to try: personal (no teamId) first, then each team
const teamsRes = await api('/v2/teams');
const teams = teamsRes.body?.teams || [];
const scopes = [{ label: 'personal', q: '' }, ...teams.map((t) => ({ label: t.slug || t.name, q: `?teamId=${t.id}`, teamId: t.id }))];

let found = null;
for (const s of scopes) {
  const r = await api(`/v9/projects/${NAME}${s.q}`);
  if (r.ok && r.body?.id) { found = { proj: r.body, scope: s }; break; }
}
if (!found) { console.error(`Could not find a Vercel project named "${NAME}" with this token. Check the token's team scope.`); process.exit(1); }

const { proj, scope } = found;
console.log(`Project : ${proj.name}   (scope: ${scope.label})`);

const amp = scope.q ? scope.q.replace('?', '&') : '';
const envRes = await api(`/v9/projects/${proj.id}/env${scope.q}`);
const rows = envRes.body?.envs || envRes.body || [];
const prodKeys = new Set(rows.filter((e) => (e.target || []).includes('production')).map((e) => e.key));

console.log('\nProduction env vars:');
let missing = 0;
for (const k of EXPECT) { const has = prodKeys.has(k); if (!has) missing++; console.log(`  ${has ? '✓' : '✗ MISSING'}  ${k}`); }

const depRes = await api(`/v6/deployments?projectId=${proj.id}&target=production&limit=1${amp}`);
const d = (depRes.body?.deployments || [])[0];
if (d) {
  const when = new Date(d.createdAt || d.created).toISOString();
  console.log(`\nLatest production deployment: https://${d.url}`);
  console.log(`  state: ${d.state || d.readyState}   created: ${when}`);
  console.log('  NOTE: env-var changes only take effect on deployments created AFTER the change.');
  console.log('        If you added SUPABASE_JWT_SECRET after this deployment, Redeploy for the MCP endpoint to see it.');
}
console.log(missing === 0 ? '\nAll four required vars are present. ✓' : `\n${missing} required var(s) missing above.`);
