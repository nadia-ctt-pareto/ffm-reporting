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

const ps = sh('ps', ['-eo', 'pid=,command=']);
if (!ps) process.exit(0); // no `ps` -- don't block

// Match the PROCESS, never the command-line text. Substring-matching "next dev"
// is badly wrong: it also matches any shell running `pkill -f "next dev"`, a
// `grep next dev`, or an editor with the string in its argv -- which made this
// guard block every single start, including the first one.
const isDevServer = (command) =>
  /^next-server\b/.test(command) || // the server process itself
  /\/node_modules\/\.bin\/next(\s|$)/.test(command); // the `next dev` launcher

const candidates = ps
  .split('\n')
  .map((line) => {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    return m ? { pid: m[1], command: m[2] } : null;
  })
  .filter((p) => p && p.pid !== String(process.pid) && isDevServer(p.command))
  .map((p) => p.pid);

// Only processes whose working directory IS this project can corrupt our
// `.next/` -- a dev server for some other repo is none of our business.
const conflicting = candidates.filter((pid) => sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).includes(`n${cwd}`));

if (conflicting.length > 0) {
  const pids = [...new Set(conflicting)].join(' ');
  // stdout, not stderr: this is a deliberate notice, not a failure. Printed on
  // stderr it reads as a crash, which is the opposite of the point.
  process.stdout.write(
    `\n  Nothing is wrong -- a dev server is ALREADY RUNNING for this project (pid ${pids}).\n` +
      `  Open http://localhost:3000 and use it.\n\n` +
      `  Not starting a second one on purpose: two servers share a single .next/\n` +
      `  and overwrite each other's build output, which surfaces as ENOENT or\n` +
      `  "reading 'call'" errors that look like application bugs but aren't.\n\n` +
      `  To restart from scratch instead:\n\n` +
      `    kill ${pids} && rm -rf .next && npm run dev\n\n`,
  );
  process.exit(1);
}
