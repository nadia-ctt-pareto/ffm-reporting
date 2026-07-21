// Points the hosted Supabase project's Auth SITE_URL + redirect allow-list at
// the real Vercel production domain, so magic-link / confirmation emails land
// on production instead of falling back to the localhost default. Discovers the
// production domain from Vercel, then PATCHes Supabase auth config. Reads both
// tokens from ./.env.deploy (gitignored). Prints before/after.
//
// Usage:  node scripts/fix-auth-urls.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.deploy', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { VERCEL_TOKEN: VT, SUPABASE_ACCESS_TOKEN: ST, SUPABASE_PROJECT_REF: REF } = env;
for (const [k, v] of Object.entries({ VERCEL_TOKEN: VT, SUPABASE_ACCESS_TOKEN: ST, SUPABASE_PROJECT_REF: REF }))
  if (!v) { console.error(`${k} missing from .env.deploy`); process.exit(1); }

const vapi = async (p) => (await fetch(`https://api.vercel.com${p}`, { headers: { Authorization: `Bearer ${VT}` } })).json();
const NAME = 'ffm-reporting';

// find the project across personal + team scopes
const teams = (await vapi('/v2/teams')).teams || [];
let proj = null, scopeQ = '';
for (const s of [{ q: '' }, ...teams.map((t) => ({ q: `?teamId=${t.id}` }))]) {
  const r = await vapi(`/v9/projects/${NAME}${s.q}`);
  if (r?.id) { proj = r; scopeQ = s.q; break; }
}
if (!proj) { console.error(`Vercel project "${NAME}" not found for this token.`); process.exit(1); }

// gather candidate production domains
const dres = await vapi(`/v9/projects/${proj.id}/domains${scopeQ}`);
const all = (dres.domains || []).map((d) => d.name).filter(Boolean);
const isDeployHash = (d) => /-[a-z0-9]{8,}-/.test(d);            // per-deploy URL, not production
const custom = all.filter((d) => !d.endsWith('.vercel.app'));
const stable = all.filter((d) => d.endsWith('.vercel.app') && !isDeployHash(d)).sort((a, b) => a.length - b.length);
const prod = custom[0] || stable[0] || all[0];
if (!prod) { console.error('Could not determine a production domain. Domains seen:', all); process.exit(1); }
const site = `https://${prod}`;

console.log('Vercel domains found :', all.join(', ') || '(none)');
console.log('Chosen production URL:', site);
console.log('  (if that is wrong, tell me the correct URL and I will set it explicitly)\n');

const allow = [
  `${site}/**`,
  'https://ffm-reporting-*.vercel.app/**',   // preview + owner-suffixed prod deploys
  'http://localhost:3000/**',                // keep local dev working
].join(',');

const sapi = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const sHeaders = { Authorization: `Bearer ${ST}`, 'Content-Type': 'application/json' };
const getCfg = async () => (await fetch(sapi, { headers: sHeaders })).json();

const before = await getCfg();
console.log('BEFORE  site_url:', before.site_url);
console.log('        uri_allow_list:', before.uri_allow_list || '(empty)');

const patch = await fetch(sapi, { method: 'PATCH', headers: sHeaders, body: JSON.stringify({ site_url: site, uri_allow_list: allow }) });
console.log('\nPATCH ->', patch.status);

const after = await getCfg();
console.log('\nAFTER   site_url:', after.site_url);
console.log('        uri_allow_list:', after.uri_allow_list);
console.log(after.site_url === site ? '\nDone — magic-link / confirm emails will now land on production. ✓' : '\nSite URL did not update — check the token.');
