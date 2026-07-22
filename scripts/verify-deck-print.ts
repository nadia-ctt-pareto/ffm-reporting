/**
 * Verifies the report deck's PRINT-PAGE-COUNT CONTRACT against a real
 * browser-generated PDF -- not against CSS inspection, and not against a
 * count of `.slide` elements in the DOM.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The deck's print output has been a repeated source of silent, invisible
 * regressions in this project (see styles/print.css's header comment): a
 * CSS-Module/global-stylesheet source-order flip once left the toolbar
 * visible and mis-sized the print stage, turning a 6-slide deck into a 7-8
 * page PDF; a fixed-height flex ancestor once collapsed the whole deck onto
 * ONE clipped page. Neither is visible on screen. Both were caught only by
 * generating an actual PDF and reading the PDF's own page tree.
 *
 * Historically that check was done with an ad-hoc Playwright script that was
 * never committed, so every phase re-derived it. This file is that check,
 * committed, with zero new dependencies -- matching the precedent set by
 * scripts/verify-ssrf.ts and scripts/verify-byok-providers.ts.
 *
 * NO NEW DEPENDENCIES
 * -------------------
 * Neither Playwright nor Puppeteer is a dependency of this project, and this
 * repo is deliberately dependency-light (see CLAUDE.md -- the CSV parser is
 * hand-rolled for the same reason). Instead this drives Chrome directly over
 * the DevTools Protocol using Node's BUILT-IN `WebSocket` (Node 22+), against
 * a `chrome-headless-shell` binary already present in the local Puppeteer
 * browser cache. `CHROME_PATH` overrides the binary if yours lives elsewhere.
 *
 * WHAT IT ASSERTS, PER FIXTURE
 * ----------------------------
 *   1. DOM slide count === `buildDeckSlides(fixture).length`
 *      -- the app's own slide-model function is imported IN-PROCESS and is
 *      the source of truth. This is what gives the contract teeth: the
 *      assertion is not "6 pages", it is "the PDF has exactly as many pages
 *      as the app says the deck has slides", which keeps holding once the
 *      slide count starts varying with content.
 *   2. Under EMULATED PRINT MEDIA, every `.slide` has
 *      `scrollHeight <= clientHeight + 1`
 *      -- i.e. nothing is clipped. `.slide` is `overflow: hidden`, so
 *      overflowing content is silently DROPPED from both the screen deck and
 *      the PDF. A page-count check alone cannot see this: a clipped slide
 *      still prints as exactly one page. This assertion is the one that
 *      catches content loss.
 *   3. The PDF's own page tree reports `/Count === buildDeckSlides().length`
 *      -- read out of the generated PDF bytes, so a trailing blank page
 *      (`.slide:last-child { break-after: auto }` regressing) or a collapsed
 *      deck both fail here.
 *   4. `MediaBox` is `[0 0 960 540]` -- 1280x720 CSS px at 96dpi is 960x540
 *      PostScript points. This proves Chromium honored `@page { size: 1280px
 *      720px }` and did NOT letterbox/scale, which is the whole basis of the
 *      "printed page IS the slide, pixel-identical" claim.
 *   5. Zero SEVERE console messages (notably React hydration mismatches --
 *      `buildDeckSlides` must stay a pure function of `report`, see its own
 *      doc comment).
 *
 * DEMO MODE, ON PURPOSE
 * ---------------------
 * The dev server is spawned with BOTH Supabase env vars blanked, so
 * `isSupabaseConfigured()` is false and the app resolves reports from
 * `localStorage`. That lets a fixture be injected with
 * `Page.addScriptToEvaluateOnNewDocument` (which runs before any page script)
 * instead of needing auth, a seeded database, or network access -- and it
 * exercises the exact same `ReportDeck`/`PresentScreen`/print.css code path
 * that Supabase mode renders.
 *
 * USAGE
 *   npx tsx scripts/verify-deck-print.ts
 *   npx tsx scripts/verify-deck-print.ts --keep-pdfs   # write PDFs to /tmp for eyeballing
 *
 * Exits 0 if every assertion passes, 1 otherwise. Any failure prints the
 * fixture, the assertion, expected vs. actual.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDeckSlides } from '../lib/deck-slides';
import type { AnyReport, DailyReport, WeeklyReport } from '../lib/types';

const DEV_PORT = Number(process.env.VERIFY_DEV_PORT ?? 3100);
const CDP_PORT = Number(process.env.VERIFY_CDP_PORT ?? 9333);
const BASE_URL = `http://127.0.0.1:${DEV_PORT}`;
const KEEP_PDFS = process.argv.includes('--keep-pdfs');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-146.0.7680.153/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

/** 1280x720 CSS px at 96dpi, expressed in PostScript points (72/inch). */
const EXPECTED_MEDIABOX = [0, 0, 960, 540] as const;

// ---------------------------------------------------------------------------
// Fixtures
//
// Every fixture is a complete, valid `AnyReport`. They deliberately span the
// cases the pagination work has to get right:
//   * `baseline-weekly` / `baseline-daily` -- small reports that must keep
//     producing today's slide count. This is the REGRESSION case: it is what
//     proves a pagination change didn't disturb reports that never overflowed.
//   * `overflow-tasks` -- 40 tasks with deliberately mixed title lengths
//     (20-300 chars), the case that silently clipped before pagination.
//   * `overflow-mixed` -- long risks AND many priorities AND a long prose
//     narrative, so no single section is the only thing being chunked.
//   * `daily-many-clients` -- 24 tasks across 6 clients (the daily deck groups
//     by client, so group headers add their own height and widow rules).
//   * `daily-no-win` -- a daily whose win was never recorded.
// ---------------------------------------------------------------------------

function core(id: string) {
  return {
    id,
    status: 'Final' as const,
    preparedFor: 'Acme Corp Leadership',
    preparedBy: 'Foundation First Marketing',
    createdAt: '2026-07-13',
    updatedAt: '2026-07-17',
    summaryNarrative: 'Steady progress across every active account this period.',
    tasks: [],
    risks: [],
    win: { stat: '42%', label: 'Lift in qualified leads', narrative: 'The paid-search restructure landed.' },
    touchpoints: { calls: 12, emails: 48, escalations: 1, narrative: 'Cadence held across all accounts.' },
    priorities: [],
  };
}

const CLIENTS = ['Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Litware', 'Proseware'];

function makeTasks(n: number): WeeklyReport['tasks'] {
  return Array.from({ length: n }, (_, i) => {
    // Cycle short / medium / long titles so wrapped-line estimation is
    // actually exercised rather than every row being one uniform height.
    const len = [20, 60, 300, 120][i % 4];
    const title = `Task ${i + 1} `.padEnd(len, 'deliverable scope detail ').slice(0, len).trim();
    return {
      id: `t${i + 1}`,
      client: CLIENTS[i % CLIENTS.length],
      task: title,
      status: (['Complete', 'In Progress', 'Blocked'] as const)[i % 3],
      deadline: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    };
  });
}

function makeRisks(n: number): WeeklyReport['risks'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `rk${i + 1}`,
    client: CLIENTS[i % CLIENTS.length],
    description: `Risk ${i + 1}: `.padEnd(260, 'a sustained dependency on a single upstream approver ').slice(0, 260),
    severity: (['Blocked', 'At Risk'] as const)[i % 2],
    nextStep: `Escalate to the account lead and confirm a backup approver by end of week ${i + 1}.`,
  }));
}

function makePriorities(n: number): WeeklyReport['priorities'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    text: `Priority ${i + 1}: `.padEnd([40, 180, 90][i % 3], 'ship the revised campaign brief and confirm budget ').slice(0, [40, 180, 90][i % 3]),
  }));
}

const LONG_NARRATIVE = Array.from(
  { length: 6 },
  (_, i) =>
    `Paragraph ${i + 1}. ` +
    'This period saw sustained delivery across every active account, with the paid-search restructure landing on schedule and the creative refresh moving into its second review cycle. '.repeat(2)
).join('\n\n');

function weekly(id: string, over: Partial<WeeklyReport>): WeeklyReport {
  return { ...core(id), kind: 'weekly', weekStart: '2026-07-13', weekEnd: '2026-07-17', ...over } as WeeklyReport;
}
function daily(id: string, over: Partial<DailyReport>): DailyReport {
  return { ...core(id), kind: 'daily', date: '2026-07-15', ...over } as DailyReport;
}

interface Fixture {
  name: string;
  report: AnyReport;
  /** `/reports` for a weekly, `/daily` for a daily -- the present route is kind-scoped. */
  base: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'baseline-weekly',
    base: '/reports',
    report: weekly('vfy-w-base', { tasks: makeTasks(5), risks: makeRisks(2), priorities: makePriorities(3) }),
  },
  {
    name: 'baseline-daily',
    base: '/daily',
    report: daily('vfy-d-base', { tasks: makeTasks(4), risks: makeRisks(1), priorities: makePriorities(3) }),
  },
  {
    name: 'overflow-tasks',
    base: '/reports',
    report: weekly('vfy-w-tasks', { tasks: makeTasks(40), risks: makeRisks(2), priorities: makePriorities(3) }),
  },
  {
    name: 'overflow-mixed',
    base: '/reports',
    report: weekly('vfy-w-mixed', {
      summaryNarrative: LONG_NARRATIVE,
      tasks: makeTasks(18),
      risks: makeRisks(8),
      priorities: makePriorities(15),
    }),
  },
  {
    name: 'daily-many-clients',
    base: '/daily',
    report: daily('vfy-d-clients', { tasks: makeTasks(24), risks: makeRisks(4), priorities: makePriorities(6) }),
  },
  {
    name: 'daily-no-win',
    base: '/daily',
    report: daily('vfy-d-nowin', {
      tasks: makeTasks(6),
      risks: makeRisks(2),
      priorities: makePriorities(4),
      win: { stat: '', label: '', narrative: '' },
    }),
  },
];

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
// ---------------------------------------------------------------------------

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
}

class Cdp {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private listeners: Array<(m: CdpMessage) => void> = [];

  static async connect(url: string): Promise<Cdp> {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      cdp.ws.addEventListener('open', () => resolve(), { once: true });
      cdp.ws.addEventListener('error', () => reject(new Error(`CDP websocket failed: ${url}`)), { once: true });
    });
    cdp.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id !== undefined) {
        const slot = cdp.pending.get(msg.id);
        if (slot) {
          cdp.pending.delete(msg.id);
          if (msg.error) slot.reject(new Error(msg.error.message));
          else slot.resolve(msg.result as never);
        }
      } else {
        for (const l of cdp.listeners) l(msg);
      }
    });
    return cdp;
  }

  /** Returns an unsubscribe fn -- per-fixture listeners must not accumulate across the run, or fixture N reports fixture 1's console errors too. */
  on(fn: (m: CdpMessage) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /**
   * Every call is timeout-bounded. This is not defensive padding -- an
   * un-timed `send` hung this harness indefinitely in practice: a
   * `Runtime.evaluate` whose `awaitPromise` promise raced a navigation never
   * got a CDP response at all, so the whole run wedged with no output and no
   * failure. A harness that can hang forever is worse than one that fails,
   * because a hang reads as "still working" in CI and in a terminal alike.
   */
  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 60_000
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: ((v: never) => {
          clearTimeout(timer);
          resolve(v);
        }) as (v: never) => void,
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

// ---------------------------------------------------------------------------
// PDF page-tree parsing.
//
// Chromium's `Page.printToPDF` emits an uncompressed cross-reference table
// with plain `/Type /Pages ... /Count N` and `/MediaBox [...]` dictionaries,
// so a byte scan is sufficient and needs no PDF library. The page-tree ROOT
// carries the total count; intermediate nodes carry partial counts, so the
// MAX of all `/Count` values is the total. `parsePdf` throws rather than
// guessing if no `/Count` is present at all -- a silently-zero page count
// would be a worse failure than a loud one.
// ---------------------------------------------------------------------------

function parsePdf(bytes: Buffer): { pageCount: number; mediaBox: number[] | null } {
  const text = bytes.toString('latin1');

  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length === 0) throw new Error('No /Count found in PDF page tree -- cannot verify page count.');
  const pageCount = Math.max(...counts);

  const mb = text.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/);
  const mediaBox = mb ? [Number(mb[1]), Number(mb[2]), Number(mb[3]), Number(mb[4])] : null;

  return { pageCount, mediaBox };
}

// ---------------------------------------------------------------------------
// Process orchestration
// ---------------------------------------------------------------------------

async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${label} at ${url} (last: ${lastErr})`);
}

function startDevServer(): ChildProcess {
  // `next` is spawned DIRECTLY, not via `npm run dev`: the `predev` lifecycle
  // hook runs scripts/check-single-dev.mjs, which (correctly) refuses to start
  // a second dev server. This one is short-lived, on its own port, and its own
  // .next dir -- so it must bypass that guard rather than trip it.
  //
  // BOTH Supabase vars are blanked so `isSupabaseConfigured()` is false (it
  // requires both) and the app runs in demo/localStorage mode. A real
  // environment variable outranks .env.local in Next's precedence order.
  return spawn('node_modules/.bin/next', ['dev', '-p', String(DEV_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
      // A separate build dir keeps this from fighting a dev server or build
      // the user is running in the same checkout -- the exact collision
      // scripts/check-single-dev.mjs exists to prevent.
      NEXT_DIST_DIR: '.next-verify',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // `next dev` forks a `next-server` child. Killing only the parent orphans
    // that child, which keeps holding the port AND trips
    // scripts/check-single-dev.mjs on the user's very next `npm run build` --
    // observed exactly once, hence `detached` so the whole process GROUP can
    // be signalled in the cleanup path below.
    detached: true,
  });
}

function startChrome(userDataDir: string): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) {
    throw new Error(
      `No Chrome binary found. Tried:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join('\n')}\nSet CHROME_PATH to override.`
    );
  }
  console.log(`  chrome: ${bin}`);
  return spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // 1280x720 deck at scale 1 -- the present route fit-scales to the
      // viewport on SCREEN, but print media ignores that transform entirely
      // (styles/print.css resets `.slideScaler`), so this only affects what
      // the screen-media assertions see.
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

interface Failure {
  fixture: string;
  assertion: string;
  detail: string;
}

const failures: Failure[] = [];

function check(ok: boolean, fixture: string, assertion: string, detail: string): void {
  if (ok) {
    console.log(`    PASS  ${assertion}`);
  } else {
    console.log(`    FAIL  ${assertion} -- ${detail}`);
    failures.push({ fixture, assertion, detail });
  }
}

async function verifyFixture(cdp: Cdp, sessionId: string, fx: Fixture): Promise<void> {
  const expected = buildDeckSlides(fx.report).length;
  console.log(`\n  [${fx.name}] expecting ${expected} slides -> ${expected} PDF pages`);

  const severeConsole: string[] = [];
  const onMessage = (m: CdpMessage) => {
    if (m.method === 'Log.entryAdded') {
      const entry = (m.params as { entry?: { level?: string; text?: string } } | undefined)?.entry;
      if (entry?.level === 'error') severeConsole.push(entry.text ?? '');
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const p = m.params as { type?: string; args?: Array<{ value?: unknown }> } | undefined;
      if (p?.type === 'error') severeConsole.push(p.args?.map((a) => String(a.value)).join(' ') ?? '');
    }
  };
  const offMessage = cdp.on(onMessage);

  // Seed localStorage BEFORE any page script runs. `ff.reports.v2` is the
  // unified store holding `AnyReport[]` (weeklies + dailies) -- see
  // LocalStorageReportsRepository. Writing a valid payload suppresses seeding,
  // so the deck renders exactly this fixture and nothing else.
  await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: `try { localStorage.setItem('ff.reports.v2', ${JSON.stringify(JSON.stringify([fx.report]))}); } catch (e) {}` },
    sessionId
  );

  const url = `${BASE_URL}${fx.base}/${fx.report.id}/present`;
  await cdp.send('Page.navigate', { url }, sessionId);

  // Poll for the deck to be mounted AND webfonts settled. Polling (rather than
  // waiting on Page.loadEventFired) is deliberate: in demo mode the report is
  // resolved from localStorage inside a client effect, so the deck appears
  // strictly after load.
  // Each poll is individually timeout-bounded AND its rejection is swallowed:
  // a single evaluate racing the navigation (or arriving mid-hydration) must
  // cost one 5s poll, never the whole run. See Cdp.send's doc comment.
  const deadline = Date.now() + 60_000;
  let domSlides = -1;
  while (Date.now() < deadline) {
    try {
      const res = await cdp.send<{ result: { value: number } }>(
        'Runtime.evaluate',
        {
          expression: `(async () => { await document.fonts.ready; return document.querySelectorAll('.slide').length; })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        5_000
      );
      domSlides = Number(res.result?.value ?? -1);
      if (domSlides > 0) break;
    } catch {
      // Evaluate timed out or the context was torn down mid-navigation; retry.
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  check(domSlides === expected, fx.name, 'DOM .slide count === buildDeckSlides().length', `expected ${expected}, got ${domSlides}`);

  // Clipping check, under EMULATED PRINT MEDIA. This must run in print media,
  // not screen: on screen the deck is transform-scaled and all but the active
  // slide is display:none (a display:none element reports 0/0 and would
  // trivially "pass"). In print every slide is laid out at full 1280x720.
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);

  // IN-FLOW content only. A naive `scrollHeight > clientHeight` test reports a
  // false positive on the cover slide for EVERY report: `.coverDiagonal` is
  // the brand's signature diagonal band -- `position: absolute; bottom: -10%;
  // height: 60%; transform: rotate(-4deg)`, i.e. it is DESIGNED to bleed past
  // the slide's edges and be trimmed by `.slide { overflow: hidden }`. It is
  // decoration (`aria-hidden`), carries no content, and its clipping is the
  // intended visual. Counting it as "clipped content" would make this
  // assertion permanently red and therefore worthless.
  //
  // So: measure the bottom edge of the last IN-FLOW (non-absolute) direct
  // child against the slide's content box (its padding box minus
  // padding-bottom). That is precisely "did real content run past where it
  // may legibly sit", which is the thing pagination has to fix.
  const clip = await cdp.send<{ result: { value: { worst: number; offenders: string[] } } }>(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const slides = [...document.querySelectorAll('.slide')];
        const offenders = [];
        let worst = 0;
        slides.forEach((el, i) => {
          const slideRect = el.getBoundingClientRect();
          const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
          const contentBottom = slideRect.bottom - padBottom;
          let lowest = -Infinity;
          for (const child of el.children) {
            const cs = getComputedStyle(child);
            if (cs.position === 'absolute' || cs.position === 'fixed') continue;
            if (child.getAttribute('aria-hidden') === 'true') continue;
            if (cs.display === 'none') continue;
            lowest = Math.max(lowest, child.getBoundingClientRect().bottom);
          }
          if (lowest === -Infinity) return;
          const over = Math.round(lowest - contentBottom);
          if (over > worst) worst = over;
          if (over > 1) offenders.push(i + ':+' + over + 'px');
        });
        return { worst, offenders };
      })()`,
      returnByValue: true,
    },
    sessionId
  );
  const clipResult = clip.result?.value ?? { worst: -1, offenders: ['<eval failed>'] };
  check(
    clipResult.offenders.length === 0,
    fx.name,
    'no slide clips content in print media (scrollHeight <= clientHeight)',
    `overflow by up to ${clipResult.worst}px on slides [${clipResult.offenders.join(', ')}]`
  );

  await cdp.send('Emulation.setEmulatedMedia', { media: '' }, sessionId);

  // `preferCSSPageSize` is what makes `@page { size: 1280px 720px }` win over
  // the default Letter -- without it MediaBox comes back 612x792 and the
  // "printed page IS the slide" contract is silently broken.
  const pdf = await cdp.send<{ data: string }>(
    'Page.printToPDF',
    { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    sessionId
  );
  const bytes = Buffer.from(pdf.data, 'base64');

  if (KEEP_PDFS) {
    const out = join(tmpdir(), `deck-${fx.name}.pdf`);
    writeFileSync(out, bytes);
    console.log(`    (pdf written to ${out})`);
  }

  const { pageCount, mediaBox } = parsePdf(bytes);
  check(pageCount === expected, fx.name, 'PDF /Count === buildDeckSlides().length', `expected ${expected}, got ${pageCount}`);
  check(
    mediaBox !== null && EXPECTED_MEDIABOX.every((v, i) => Math.abs((mediaBox[i] ?? -1) - v) < 1),
    fx.name,
    'PDF MediaBox === [0 0 960 540] (1280x720px honored, not letterboxed)',
    `got ${mediaBox ? `[${mediaBox.join(' ')}]` : 'none'}`
  );

  const hydration = severeConsole.filter((t) => /hydrat|did not match|Minified React error #4\d\d/i.test(t));
  check(hydration.length === 0, fx.name, 'no React hydration errors in console', hydration.slice(0, 2).join(' | '));

  offMessage();
}

async function main(): Promise<void> {
  console.log('Deck print-contract verification\n================================');

  const userDataDir = mkdtempSync(join(tmpdir(), 'deck-verify-'));
  let dev: ChildProcess | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;

  try {
    console.log(`\nStarting dev server (demo mode) on :${DEV_PORT} ...`);
    dev = startDevServer();
    dev.stderr?.on('data', (d) => {
      const s = String(d);
      if (/error/i.test(s)) process.stderr.write(`  [dev] ${s}`);
    });
    await waitForHttp(`${BASE_URL}/reports`, 120_000, 'dev server');
    console.log('  dev server ready');

    console.log(`\nStarting headless Chrome on :${CDP_PORT} ...`);
    chrome = startChrome(userDataDir);
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 30_000, 'chrome');

    const version = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
      Browser: string;
    };
    console.log(`  ${version.Browser}`);

    cdp = await Cdp.connect(version.webSocketDebuggerUrl);
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);

    for (const fx of FIXTURES) {
      await verifyFixture(cdp, sessionId, fx);
    }
  } finally {
    cdp?.close();
    chrome?.kill('SIGKILL');
    // Negative pid = "the whole process group", which is what actually reaps
    // `next dev`'s forked `next-server`. See startDevServer's `detached` note.
    if (dev?.pid) {
      try {
        process.kill(-dev.pid, 'SIGKILL');
      } catch {
        dev.kill('SIGKILL');
      }
    }
  }

  console.log('\n================================');
  if (failures.length === 0) {
    console.log(`ALL CHECKS PASSED (${FIXTURES.length} fixtures)`);
    process.exit(0);
  }
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  [${f.fixture}] ${f.assertion}\n      ${f.detail}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\nHARNESS ERROR:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
