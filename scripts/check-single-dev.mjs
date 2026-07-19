// Guards `.next/` against concurrent writers. Wired to BOTH `predev` and
// `prebuild`, because `next dev` and `next build` share one output directory
// and neither tolerates the other writing into it.
//
// Two writers clobber each other mid-write, and every symptom looks like an
// application or dependency bug rather than a collision:
//   * "Cannot read properties of undefined (reading 'call')"  (the chunk graph
//     references a module the other writer just rewrote)
//   * "ENOENT: ... .next/server/app/**/route.js"              (one process read
//     a route the other hadn't finished writing)
//   * "Cannot find module './331.js'" from webpack-runtime    (`next build`
//     replaced the dev server's server chunks underneath it)
//   * a second dev server silently taking port 3001, so half your requests hit
//     a different process than the tab you have open
//
// Each of those cost real debugging time in this project. The check fails fast
// with the offending pids instead. macOS/Linux only (`ps` + `lsof`); on any
// other platform, or if either tool is unavailable, it no-ops rather than
// blocking legitimate work.

import { execFileSync } from 'node:child_process';

const cwd = process.cwd();
// npm sets this to the lifecycle script actually executing -- so it is
// "prebuild"/"predev", NOT "build"/"dev". Match both spellings so this keeps
// working if the hooks are ever inlined into the main scripts.
const lifecycle = process.env.npm_lifecycle_event ?? '';
const runningScript = lifecycle === 'prebuild' || lifecycle === 'build' ? 'build' : 'dev';

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
// `grep next dev`, or an editor with the string in its argv -- which made an
// earlier version of this guard block every single start, including the first.
const isNextProcess = (command) =>
  /^next-server\b/.test(command) || // a running dev/start server
  /\/node_modules\/\.bin\/next(\s|$)/.test(command); // a `next dev` / `next build` invocation

const candidates = ps
  .split('\n')
  .map((line) => {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    return m ? { pid: m[1], command: m[2] } : null;
  })
  .filter((p) => p && p.pid !== String(process.pid) && isNextProcess(p.command))
  .map((p) => p.pid);

// Only processes whose working directory IS this project can corrupt our
// `.next/` -- a Next process for some other repo is none of our business.
const conflicting = candidates.filter((pid) => sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).includes(`n${cwd}`));

if (conflicting.length > 0) {
  const pids = [...new Set(conflicting)].join(' ');
  const detail =
    runningScript === 'build'
      ? `  Not building while it runs: \`next build\` writes into the same .next/\n` +
        `  the dev server is serving from, and replacing those chunks underneath\n` +
        `  it breaks the running app with errors that look like real bugs.\n\n` +
        `  Stop it first, then build:\n\n    kill ${pids} && npm run build\n\n`
      : `  Open http://localhost:3000 and use it.\n\n` +
        `  Not starting a second one on purpose: two servers share a single .next/\n` +
        `  and overwrite each other's build output, which surfaces as ENOENT or\n` +
        `  "reading 'call'" errors that look like application bugs but aren't.\n\n` +
        `  To restart from scratch instead:\n\n    kill ${pids} && rm -rf .next && npm run dev\n\n`;

  // stdout, not stderr: this is a deliberate notice, not a failure. Printed on
  // stderr it reads as a crash, which is the opposite of the point.
  process.stdout.write(`\n  Nothing is wrong -- a Next process is ALREADY RUNNING for this project (pid ${pids}).\n${detail}`);
  process.exit(1);
}
