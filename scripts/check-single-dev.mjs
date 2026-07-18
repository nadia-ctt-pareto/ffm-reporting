// Refuses to start a second `next dev` against this project directory.
//
// Two dev servers sharing one `.next/` clobber each other's build output
// mid-write. The symptoms look like application bugs but aren't:
//   * "Cannot read properties of undefined (reading 'call')"  (chunk graph
//     references a module the other server just rewrote)
//   * "ENOENT: ... .next/server/app/**/route.js"              (one server
//     read a route the other hadn't finished writing)
//   * the second server silently taking port 3001, so half your requests
//     hit a different process than the tab you have open
//
// This cost real debugging time three separate times in this project, so
// `predev` now fails fast with the pids instead. macOS/Linux only (`ps` +
// `lsof`); on any other platform, or if either tool is unavailable, the
// check no-ops rather than blocking a legitimate start.

import { execFileSync } from 'node:child_process';

const cwd = process.cwd();

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const ps = sh('ps', ['-eo', 'pid,command']);
if (!ps) process.exit(0); // no `ps` -- don't block

const candidates = ps
  .split('\n')
  .filter((line) => /next-server|next dev/.test(line))
  .filter((line) => !/check-single-dev/.test(line))
  .map((line) => line.trim().split(/\s+/)[0])
  .filter((pid) => /^\d+$/.test(pid) && pid !== String(process.pid));

// Only processes whose working directory IS this project can corrupt our
// `.next/` -- a dev server for some other repo is none of our business.
const conflicting = candidates.filter((pid) => sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).includes(`n${cwd}`));

if (conflicting.length > 0) {
  const pids = [...new Set(conflicting)].join(' ');
  process.stderr.write(
    `\n  A dev server is already running for this project (pid ${pids}).\n\n` +
      `  Two servers share one .next/ and corrupt each other's build output,\n` +
      `  which shows up as ENOENT or "reading 'call'" errors that look like\n` +
      `  application bugs. Use the server that's already running, or:\n\n` +
      `    kill ${pids} && rm -rf .next && npm run dev\n\n`,
  );
  process.exit(1);
}
