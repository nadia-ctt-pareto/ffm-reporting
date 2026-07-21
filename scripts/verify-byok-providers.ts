// Ad-hoc verification harness for the BYOK generalization's two provider
// request/response builders (lib/server/ai-polish.ts) and error mapping
// (lib/server/reports-service.ts's curatedMessage) -- same convention as
// scripts/check-mcp-tool-contract.ts/scripts/verify-ssrf.ts: a plain tsx
// script, explicit PASS/FAIL assertions, exit code 1 on any failure.
//
// This exercises the REAL production code (polishField, setAiKey,
// curatedMessage) end to end -- nothing here is reimplemented or mocked
// except the I/O boundaries that would otherwise require a live Supabase
// instance and a real provider account: the Supabase client (a hand-rolled
// fake implementing only the two calls these functions make -- `.rpc()`
// and `.from('ai_keys').select(...).maybeSingle()`) and the outbound fetch
// (stubbed per-case to return controlled responses, after real SSRF
// validation + pinned-dispatcher construction has already run against a
// REAL public hostname -- see below). `AI_BYOK_ENCRYPTION_KEY` is a real,
// freshly generated key, and `lib/server/ai-crypto.ts`'s real encrypt/
// decrypt runs unmocked throughout, so the crypto round-trip is exercised
// for real too.
//
// TWO different fetch stubs, matching the TWO different transports
// lib/server/ai-polish.ts now uses (SEC-3, post-review):
//   - Anthropic: still Node's global `fetch` (its base URL is fixed, never
//     user input, so it never needed SSRF pinning) -- `stubFetch` below
//     reassigns `globalThis.fetch` directly.
//   - openai_compatible: `undici`'s own exported `fetch`, called through a
//     pinned `Dispatcher` built from a REAL SSRF-validated DNS lookup (see
//     lib/server/ssrf.ts's `buildPinnedDispatcher`) -- reassigning
//     `globalThis.fetch` does NOT intercept this (verified: a separately
//     mutated `undici` module export is not observed by an already-
//     evaluated static `import` elsewhere, so simple monkey-patching
//     doesn't work either). Instead, `callOpenAiCompatible` (and every
//     function above it -- `validateOpenAiCompatibleKey`, `polishField`,
//     `setAiKey`) accepts an OPTIONAL, test-only `fetchImpl`/`openAiFetchImpl`
//     parameter (see each function's own doc comment) -- `stubOpenAiFetch`
//     below builds a recording stub of that exact shape, passed explicitly
//     by every openai_compatible test case in this file. Real route
//     handlers never supply this parameter. The real SSRF validation +
//     pinned-dispatcher construction still runs UNCONDITIONALLY before the
//     (possibly-stubbed) fetch call either way -- only the literal network
//     I/O is swappable.
//
// Run: npx tsx scripts/verify-byok-providers.ts
//
// Requires real network access for one thing: every openai_compatible test
// case's `assertSafeOutboundUrl` call does a REAL DNS lookup against a real
// public hostname (openrouter.ai) -- the actual HTTP request that would
// follow is intercepted by the `openAiFetchImpl` stub before it ever
// leaves the process, so no real request reaches openrouter.ai from this
// script (see scripts/verify-ssrf.ts for the SEPARATE, deliberate real
// end-to-end network test of the pinning mechanism itself).

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Response as UndiciResponse } from 'undici';

process.env.AI_BYOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');

// Imported AFTER the env var above is set -- lib/server/ai-crypto.ts reads
// `AI_BYOK_ENCRYPTION_KEY` lazily (inside each function call, not at
// module-load time), but this keeps the ordering honest regardless.
import { encryptSecret } from '../lib/server/ai-crypto';
import { setAiKey, type SetAiKeyArgs } from '../lib/server/ai-keys';
import { polishField, type OpenAiFetchImpl } from '../lib/server/ai-polish';
import { curatedMessage, ServiceError } from '../lib/server/reports-service';
import type { PolishRequest } from '../lib/schema/api';

let passed = 0;
let failed = 0;

function ok(label: string): void {
  passed += 1;
  console.log(`OK:   ${label}`);
}
function fail(label: string, detail?: unknown): void {
  failed += 1;
  console.error(`FAIL: ${label}`, detail !== undefined ? detail : '');
}

// =============================================================================
// Fake Supabase client -- implements only what polishField/setAiKey call.
// =============================================================================

interface FakeAiKeysRow {
  provider: 'anthropic' | 'openai_compatible';
  base_url: string | null;
  model: string | null;
}

/** Backs polishField's two reads: getAiKeyProviderConfig (a plain select) and getAiKeyPlaintext (the get_own_ai_key_ciphertext RPC). */
function makePolishDb(ciphertext: string, row: FakeAiKeysRow): SupabaseClient {
  const fake = {
    rpc: async (fn: string) => {
      if (fn === 'get_own_ai_key_ciphertext') return { data: ciphertext, error: null };
      throw new Error(`unexpected rpc in makePolishDb: ${fn}`);
    },
    from: (table: string) => {
      if (table !== 'ai_keys') throw new Error(`unexpected table in makePolishDb: ${table}`);
      return {
        // No `columns` parameter -- this fake doesn't need to inspect which
        // columns getAiKeyProviderConfig asked for; the real Supabase
        // column-grant enforcement is verified separately, live, against
        // local Postgres (see this repo's task summary / docs/database-schema.md).
        select: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      };
    },
  };
  return fake as unknown as SupabaseClient;
}

interface RpcCall {
  fn: string;
  args: unknown;
}

/** Backs setAiKey's one write: the set_own_ai_key RPC -- records every call so the test can assert both "called with the right args" AND "never called at all" (the invalid-key-never-stored invariant). */
function makeSetKeyDb(rpcCalls: RpcCall[]): SupabaseClient {
  const fake = {
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'set_own_ai_key') return { data: '2026-07-21T00:00:00.000Z', error: null };
      throw new Error(`unexpected rpc in makeSetKeyDb: ${fn}`);
    },
  };
  return fake as unknown as SupabaseClient;
}

// =============================================================================
// Fake fetch -- records every outbound call, returns a scripted Response.
// =============================================================================

interface RecordedFetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

const originalFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown): RecordedFetchCall[] {
  const calls: RecordedFetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k.toLowerCase()] = v;
    }
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method: init?.method, headers, body: parsedBody });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

/**
 * The openai_compatible-path equivalent of `stubFetch` above -- see this
 * file's header comment for why `globalThis.fetch` reassignment does not
 * (and cannot) intercept that path anymore. Returns a `fetchImpl` matching
 * `OpenAiFetchImpl`'s exact shape, passed explicitly to `polishField`/
 * `setAiKey`/`validateOpenAiCompatibleKey`'s test-only last parameter by
 * every openai_compatible test case below -- NOT a global reassignment, so
 * no `restore` step is needed for this one.
 */
function stubOpenAiFetch(status: number, body: unknown): { calls: RecordedFetchCall[]; fetchImpl: OpenAiFetchImpl } {
  const calls: RecordedFetchCall[] = [];
  // Typed by CONTEXT (assigned directly to an `OpenAiFetchImpl`-typed
  // `const`, not cast) -- TypeScript infers `input`/`init`'s exact types
  // from `undici`'s own `fetch` signature this way, so a real shape
  // mismatch (e.g. the wrong `Response` class -- see the comment below)
  // still surfaces as a compile error, not silently cast away.
  const fetchImpl: OpenAiFetchImpl = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k.toLowerCase()] = v;
    }
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method: init?.method, headers, body: parsedBody });
    // `undici`'s own Response, NOT the global one -- `OpenAiFetchImpl`
    // (`typeof undiciFetch`) is typed against undici's own `Response`
    // shape, which is structurally different from the global `Response`
    // TypeScript otherwise infers here (verified: `tsc` rejects the global
    // one with a missing-`textStream`-property error).
    return new UndiciResponse(JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

const FAKE_ANTHROPIC_KEY = 'sk-ant-api03-THIS-IS-A-FAKE-TEST-KEY-abcdefgh';
const FAKE_OPENAI_KEY = 'sk-or-v1-THIS-IS-A-FAKE-TEST-KEY-ijklmnop';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'; // real public host -- see this file's header comment

function assertNoLeak(label: string, haystack: string, secret: string): void {
  if (haystack.includes(secret)) {
    fail(`${label} -- SECRET LEAKED into: ${haystack}`);
  } else {
    ok(`${label} -- no key material in the message`);
  }
}

// =============================================================================
// 1) Request-shape verification -- anthropic
// =============================================================================

async function verifyAnthropicRequestShape(): Promise<void> {
  const ciphertext = encryptSecret(FAKE_ANTHROPIC_KEY);
  const db = makePolishDb(ciphertext, { provider: 'anthropic', base_url: null, model: null });
  const calls = stubFetch(200, { content: [{ type: 'text', text: 'Polished output.' }] });
  try {
    const req: PolishRequest = { field: 'summary', text: 'Raw summary text.', context: { kind: 'weekly', client: 'Acme Co' } };
    const result = await polishField(db, 'user-anthropic', req);
    if (result.polished !== 'Polished output.') return fail('anthropic polishField result', result);
    ok('anthropic polishField returns the extracted+cleaned text');

    if (calls.length !== 1) return fail('anthropic polishField: expected exactly 1 fetch call', calls.length);
    const call = calls[0];
    if (call.url !== 'https://api.anthropic.com/v1/messages') return fail('anthropic request URL', call.url);
    ok('anthropic request hits the fixed Messages URL');
    if (call.headers['x-api-key'] !== FAKE_ANTHROPIC_KEY) return fail('anthropic x-api-key header', call.headers);
    ok('anthropic request sends the decrypted key as x-api-key');
    if (!call.headers['anthropic-version']) return fail('anthropic-version header missing', call.headers);
    ok('anthropic request sends anthropic-version');
    if (call.headers['authorization']) return fail('anthropic request should NOT send an Authorization header', call.headers);
    ok('anthropic request has no stray Authorization header');

    const body = call.body as { model?: string; max_tokens?: number; system?: string; messages?: unknown[] };
    if (body.model !== 'claude-sonnet-5') return fail('anthropic body.model should default to POLISH_MODEL', body.model);
    ok('anthropic body.model defaults to POLISH_MODEL when no override is stored');
    if (body.max_tokens !== 500) return fail('anthropic body.max_tokens', body.max_tokens);
    if (typeof body.system !== 'string' || !body.system.includes('Foundation First')) return fail('anthropic body.system missing HOUSE_VOICE', body.system);
    ok('anthropic body.system carries HOUSE_VOICE');
    if (!Array.isArray(body.messages) || body.messages.length !== 1) return fail('anthropic body.messages shape', body.messages);
    const msg = body.messages[0] as { role?: string; content?: string };
    if (msg.role !== 'user' || typeof msg.content !== 'string' || !msg.content.includes('Raw summary text.')) {
      return fail('anthropic body.messages[0]', msg);
    }
    ok('anthropic body.messages is a single user turn carrying the field text');
  } finally {
    restoreFetch();
  }
}

// =============================================================================
// 2) Request-shape verification -- openai_compatible
// =============================================================================

async function verifyOpenAiCompatibleRequestShape(): Promise<void> {
  const ciphertext = encryptSecret(FAKE_OPENAI_KEY);
  const db = makePolishDb(ciphertext, { provider: 'openai_compatible', base_url: OPENROUTER_BASE, model: 'anthropic/claude-sonnet-5' });
  const { calls, fetchImpl } = stubOpenAiFetch(200, { choices: [{ message: { content: 'Polished via OpenRouter.' } }] });
  const req: PolishRequest = { field: 'riskDescription', text: 'Raw risk text.', context: { severity: 'High' } };
  const result = await polishField(db, 'user-openai', req, fetchImpl);
  if (result.polished !== 'Polished via OpenRouter.') return fail('openai_compatible polishField result', result);
  ok('openai_compatible polishField returns the extracted+cleaned text');

  if (calls.length !== 1) return fail('openai_compatible polishField: expected exactly 1 fetch call', calls.length);
  const call = calls[0];
  if (call.url !== `${OPENROUTER_BASE}/chat/completions`) return fail('openai_compatible request URL', call.url);
  ok('openai_compatible request hits {base_url}/chat/completions');
  if (call.headers['authorization'] !== `Bearer ${FAKE_OPENAI_KEY}`) return fail('openai_compatible Authorization header', call.headers);
  ok('openai_compatible request sends the decrypted key as Authorization: Bearer');
  if (call.headers['x-api-key']) return fail('openai_compatible request should NOT send an x-api-key header', call.headers);
  ok('openai_compatible request has no stray x-api-key header');

  const body = call.body as { model?: string; max_tokens?: number; messages?: Array<{ role: string; content: string }> };
  if (body.model !== 'anthropic/claude-sonnet-5') return fail('openai_compatible body.model', body.model);
  ok('openai_compatible body.model is the stored model (required, no default)');
  if (body.max_tokens !== 500) return fail('openai_compatible body.max_tokens', body.max_tokens);
  if (!Array.isArray(body.messages) || body.messages.length !== 2) return fail('openai_compatible body.messages shape', body.messages);
  if (body.messages[0].role !== 'system' || !body.messages[0].content.includes('Foundation First')) {
    return fail('openai_compatible body.messages[0] (system, HOUSE_VOICE)', body.messages[0]);
  }
  ok('openai_compatible body.messages[0] is a system turn carrying HOUSE_VOICE');
  if (body.messages[1].role !== 'user' || !body.messages[1].content.includes('Raw risk text.')) {
    return fail('openai_compatible body.messages[1] (user, field text)', body.messages[1]);
  }
  ok('openai_compatible body.messages[1] is a user turn carrying the field text');
}

// =============================================================================
// 3) Error mapping -- both providers, several upstream statuses
// =============================================================================

async function verifyErrorMapping(): Promise<void> {
  const req: PolishRequest = { field: 'summary', text: 'Raw text.' };

  const cases: Array<{
    label: string;
    provider: 'anthropic' | 'openai_compatible';
    status: number;
    expectedMarker: RegExp;
    expectedCuratedSubstring: string;
  }> = [
    { label: 'anthropic 401', provider: 'anthropic', status: 401, expectedMarker: /anthropic_invalid_key/, expectedCuratedSubstring: 'Your Anthropic key was rejected' },
    { label: 'anthropic 429', provider: 'anthropic', status: 429, expectedMarker: /anthropic_rate_limited/, expectedCuratedSubstring: 'Anthropic account is rate-limited' },
    { label: 'anthropic 404', provider: 'anthropic', status: 404, expectedMarker: /anthropic_bad_model/, expectedCuratedSubstring: 'Check the model' },
    { label: 'anthropic 500', provider: 'anthropic', status: 500, expectedMarker: /anthropic_unavailable/, expectedCuratedSubstring: "Couldn't reach Anthropic" },
    { label: 'openai_compatible 401', provider: 'openai_compatible', status: 401, expectedMarker: /openai_invalid_key/, expectedCuratedSubstring: 'Your API key was rejected' },
    { label: 'openai_compatible 404', provider: 'openai_compatible', status: 404, expectedMarker: /openai_bad_endpoint/, expectedCuratedSubstring: 'Check the base URL and model' },
    { label: 'openai_compatible 400', provider: 'openai_compatible', status: 400, expectedMarker: /openai_bad_endpoint/, expectedCuratedSubstring: 'Check the base URL and model' },
    { label: 'openai_compatible 429', provider: 'openai_compatible', status: 429, expectedMarker: /openai_rate_limited/, expectedCuratedSubstring: 'provider rate-limited this request' },
    { label: 'openai_compatible 503', provider: 'openai_compatible', status: 503, expectedMarker: /openai_unavailable/, expectedCuratedSubstring: "Couldn't reach the provider" },
  ];

  for (const c of cases) {
    const key = c.provider === 'anthropic' ? FAKE_ANTHROPIC_KEY : FAKE_OPENAI_KEY;
    const ciphertext = encryptSecret(key);
    const row: FakeAiKeysRow =
      c.provider === 'anthropic' ? { provider: 'anthropic', base_url: null, model: null } : { provider: 'openai_compatible', base_url: OPENROUTER_BASE, model: 'anthropic/claude-sonnet-5' };
    const db = makePolishDb(ciphertext, row);
    // A response body echoing something key-shaped -- proves the upstream
    // body is never read into the thrown error or the curated message
    // (lib/server/ai-polish.ts's callAnthropic/callOpenAiCompatible only
    // ever read res.status on a failure, never res.json()'s content).
    const responseBody = { error: { message: `upstream said something about ${key}` } };
    let openAiFetchImpl: OpenAiFetchImpl | undefined;
    if (c.provider === 'anthropic') {
      stubFetch(c.status, responseBody);
    } else {
      openAiFetchImpl = stubOpenAiFetch(c.status, responseBody).fetchImpl;
    }
    try {
      await polishField(db, `user-${c.label}`, req, openAiFetchImpl);
      fail(`${c.label} -- expected polishField to throw, it did not`);
      continue;
    } catch (err) {
      if (!(err instanceof ServiceError)) {
        fail(`${c.label} -- threw a non-ServiceError`, err);
        continue;
      }
      if (!c.expectedMarker.test(err.message)) {
        fail(`${c.label} -- marker token mismatch`, err.message);
        continue;
      }
      ok(`${c.label} -- marker token matches (${err.message})`);
      const curated = curatedMessage(err.code, err.message);
      if (!curated.includes(c.expectedCuratedSubstring)) {
        fail(`${c.label} -- curated message mismatch`, curated);
        continue;
      }
      ok(`${c.label} -- curated message: "${curated}"`);
      assertNoLeak(`${c.label} -- ServiceError.message`, err.message, key);
      assertNoLeak(`${c.label} -- curated message`, curated, key);
    } finally {
      restoreFetch();
    }
  }

  // Local rate limiter -- provider-neutral marker (verifies the fix that
  // this no longer mislabels an openai_compatible user's local throttle as
  // an "Anthropic account" problem).
  {
    const key = FAKE_OPENAI_KEY;
    const ciphertext = encryptSecret(key);
    const db = makePolishDb(ciphertext, { provider: 'openai_compatible', base_url: OPENROUTER_BASE, model: 'anthropic/claude-sonnet-5' });
    const { fetchImpl } = stubOpenAiFetch(200, { choices: [{ message: { content: 'ok' } }] });
    const userId = 'user-local-rate-limit';
    // MAX_CONCURRENT_PER_USER is 2 -- fire 3 concurrent calls, the 3rd
    // must be rejected by the LOCAL concurrency guard, not a provider
    // response (the stub always returns 200 instantly, so a slow
    // provider is not what's triggering this).
    const results = await Promise.allSettled([polishField(db, userId, req, fetchImpl), polishField(db, userId, req, fetchImpl), polishField(db, userId, req, fetchImpl)]);
    const rejections = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejections.length === 0) {
      fail('local concurrency guard -- expected at least one of 3 concurrent calls to be rejected');
    } else {
      const err = rejections[0].reason;
      if (err instanceof ServiceError && /local_rate_limited/.test(err.message)) {
        ok(`local concurrency guard -- rejected with provider-neutral local_rate_limited (${rejections.length}/3 rejected)`);
        const curated = curatedMessage(err.code, err.message);
        if (curated.includes('Anthropic')) {
          fail('local_rate_limited curated message wrongly mentions Anthropic for a non-Anthropic user', curated);
        } else {
          ok(`local_rate_limited curated message is provider-neutral: "${curated}"`);
        }
      } else {
        fail('local concurrency guard -- wrong error shape', err);
      }
    }
  }
}

// =============================================================================
// 4) setAiKey: validate-before-store, both providers
// =============================================================================

async function verifySetAiKeyValidatesBeforeStoring(): Promise<void> {
  // 4a) Anthropic, valid key -> RPC called once with the right args.
  {
    const rpcCalls: RpcCall[] = [];
    const db = makeSetKeyDb(rpcCalls);
    stubFetch(200, { content: [{ type: 'text', text: 'Hi' }] });
    try {
      const args: SetAiKeyArgs = { apiKey: FAKE_ANTHROPIC_KEY, provider: 'anthropic' };
      const result = await setAiKey(db, 'user-setkey-4a', args);
      if (rpcCalls.length !== 1 || rpcCalls[0].fn !== 'set_own_ai_key') return fail('setAiKey (anthropic, valid) -- expected exactly 1 set_own_ai_key RPC call', rpcCalls);
      const rpcArgs = rpcCalls[0].args as Record<string, unknown>;
      if (rpcArgs.p_provider !== 'anthropic') return fail('setAiKey (anthropic) -- p_provider', rpcArgs);
      if (rpcArgs.p_base_url !== null) return fail('setAiKey (anthropic) -- p_base_url should be null', rpcArgs);
      if (rpcArgs.p_model !== null) return fail('setAiKey (anthropic) -- p_model should be null when no override given', rpcArgs);
      if (typeof rpcArgs.p_key_ciphertext !== 'string' || rpcArgs.p_key_ciphertext === FAKE_ANTHROPIC_KEY) {
        return fail('setAiKey (anthropic) -- p_key_ciphertext should be encrypted, not the raw key', rpcArgs);
      }
      ok('setAiKey (anthropic, valid) -- calls set_own_ai_key once with encrypted ciphertext + provider=anthropic, base_url/model=null');
      assertNoLeak('setAiKey (anthropic) -- returned hint', result.hint + result.validatedAt, FAKE_ANTHROPIC_KEY);
    } finally {
      restoreFetch();
    }
  }

  // 4b) OpenAI-compatible, valid key+base+model -> RPC called once with the right args.
  {
    const rpcCalls: RpcCall[] = [];
    const db = makeSetKeyDb(rpcCalls);
    const { fetchImpl } = stubOpenAiFetch(200, { choices: [{ message: { content: '.' } }] });
    const args: SetAiKeyArgs = { apiKey: FAKE_OPENAI_KEY, provider: 'openai_compatible', baseUrl: OPENROUTER_BASE, model: 'anthropic/claude-sonnet-5' };
    await setAiKey(db, 'user-setkey-4b', args, fetchImpl);
    if (rpcCalls.length !== 1) return fail('setAiKey (openai_compatible, valid) -- expected exactly 1 RPC call', rpcCalls);
    const rpcArgs = rpcCalls[0].args as Record<string, unknown>;
    if (rpcArgs.p_provider !== 'openai_compatible') return fail('setAiKey (openai_compatible) -- p_provider', rpcArgs);
    if (rpcArgs.p_base_url !== OPENROUTER_BASE) return fail('setAiKey (openai_compatible) -- p_base_url', rpcArgs);
    if (rpcArgs.p_model !== 'anthropic/claude-sonnet-5') return fail('setAiKey (openai_compatible) -- p_model', rpcArgs);
    ok('setAiKey (openai_compatible, valid) -- calls set_own_ai_key once with provider/base_url/model set correctly');
  }

  // 4c) Anthropic, INVALID key (401) -> setAiKey throws, RPC NEVER called (never store an invalid key).
  {
    const rpcCalls: RpcCall[] = [];
    const db = makeSetKeyDb(rpcCalls);
    stubFetch(401, { error: { message: 'invalid x-api-key' } });
    try {
      const args: SetAiKeyArgs = { apiKey: FAKE_ANTHROPIC_KEY, provider: 'anthropic' };
      await setAiKey(db, 'user-setkey-4c', args);
      fail('setAiKey (anthropic, invalid) -- expected a throw, none occurred');
    } catch (err) {
      if (rpcCalls.length !== 0) {
        fail('setAiKey (anthropic, invalid) -- set_own_ai_key was called despite an invalid key', rpcCalls);
      } else if (err instanceof ServiceError && /anthropic_invalid_key/.test(err.message)) {
        ok('setAiKey (anthropic, invalid) -- rejected BEFORE any RPC call, never persisted');
      } else {
        fail('setAiKey (anthropic, invalid) -- wrong error shape', err);
      }
    } finally {
      restoreFetch();
    }
  }

  // 4d) OpenAI-compatible, base_url pointing at a private address -> SSRF-rejected, RPC NEVER called.
  {
    const rpcCalls: RpcCall[] = [];
    const db = makeSetKeyDb(rpcCalls);
    // A fetch stub that WOULD succeed if ever reached -- assertSafeOutboundUrl
    // should reject BEFORE this is ever called at all.
    const { calls, fetchImpl } = stubOpenAiFetch(200, {});
    try {
      const args: SetAiKeyArgs = { apiKey: FAKE_OPENAI_KEY, provider: 'openai_compatible', baseUrl: 'https://169.254.169.254/latest', model: 'whatever' };
      await setAiKey(db, 'user-setkey-4d', args, fetchImpl);
      fail('setAiKey (openai_compatible, private base_url) -- expected a throw, none occurred');
    } catch (err) {
      if (calls.length !== 0) {
        fail('setAiKey (openai_compatible, private base_url) -- fetch was attempted despite an unsafe base_url');
      } else if (rpcCalls.length !== 0) {
        fail('setAiKey (openai_compatible, private base_url) -- set_own_ai_key was called despite SSRF rejection', rpcCalls);
      } else if (err instanceof ServiceError && /openai_bad_endpoint/.test(err.message)) {
        ok('setAiKey (openai_compatible, private base_url) -- SSRF-rejected at save time, before any outbound fetch or RPC call');
      } else {
        fail('setAiKey (openai_compatible, private base_url) -- wrong error shape', err);
      }
    }
  }
}

// =============================================================================
// 4e/4f) SEC-2 (post-review): setAiKey's validation call is now rate-limited
// through the SAME per-user limiter polishField uses -- previously
// `PUT /api/ai/key` was an unthrottled arbitrary-outbound primitive.
// =============================================================================

async function verifySetAiKeyIsRateLimited(): Promise<void> {
  // 4e) The concurrency cap applies to setAiKey's OWN validation calls --
  // fire 3 concurrent validations for the SAME user (MAX_CONCURRENT_PER_USER
  // is 2); at least the 3rd must be rejected, never reaching the provider.
  {
    const userId = 'user-setkey-concurrency';
    stubFetch(200, { content: [{ type: 'text', text: 'Hi' }] });
    try {
      const makeArgs = (): SetAiKeyArgs => ({ apiKey: FAKE_ANTHROPIC_KEY, provider: 'anthropic' });
      const results = await Promise.allSettled([
        setAiKey(makeSetKeyDb([]), userId, makeArgs()),
        setAiKey(makeSetKeyDb([]), userId, makeArgs()),
        setAiKey(makeSetKeyDb([]), userId, makeArgs()),
      ]);
      const rejections = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejections.length === 0) {
        fail('SEC-2 -- setAiKey concurrency cap: expected at least one of 3 concurrent validation calls to be rejected');
      } else {
        const err = rejections[0].reason;
        if (err instanceof ServiceError && /local_rate_limited/.test(err.message)) {
          ok(`SEC-2 -- setAiKey's OWN validation calls are now rate-limited (${rejections.length}/3 rejected, same limiter as polishField)`);
        } else {
          fail('SEC-2 -- setAiKey concurrency cap: wrong error shape', err);
        }
      }
    } finally {
      restoreFetch();
    }
  }

  // 4f) The budget is SHARED with polishField, not a separate pool -- a
  // real polish call plus validation calls for the SAME user compete for
  // the SAME 2 concurrent slots.
  {
    const userId = 'user-shared-budget';
    stubFetch(200, { content: [{ type: 'text', text: 'Hi' }], choices: [{ message: { content: 'ok' } }] });
    try {
      const ciphertext = encryptSecret(FAKE_ANTHROPIC_KEY);
      const polishDb = makePolishDb(ciphertext, { provider: 'anthropic', base_url: null, model: null });
      const req: PolishRequest = { field: 'summary', text: 'Raw text.' };
      const setKeyArgs: SetAiKeyArgs = { apiKey: FAKE_ANTHROPIC_KEY, provider: 'anthropic' };

      const results = await Promise.allSettled([
        polishField(polishDb, userId, req),
        setAiKey(makeSetKeyDb([]), userId, setKeyArgs),
        setAiKey(makeSetKeyDb([]), userId, setKeyArgs),
      ]);
      const rejections = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejections.length === 0) {
        fail('SEC-2 -- shared budget: expected at least one of (1 polish + 2 setAiKey) concurrent calls for the same user to be rejected');
      } else {
        const err = rejections[0].reason;
        if (err instanceof ServiceError && /local_rate_limited/.test(err.message)) {
          ok(`SEC-2 -- polishField and setAiKey share the SAME per-user budget, not separate pools (${rejections.length}/3 rejected)`);
        } else {
          fail('SEC-2 -- shared budget: wrong error shape', err);
        }
      }
    } finally {
      restoreFetch();
    }
  }
}

// =============================================================================
// 5) polishField: SSRF defense-in-depth (stored base_url is re-validated on EVERY call, not just at save time)
// =============================================================================

async function verifyPolishFieldRevalidatesSsrfOnEveryCall(): Promise<void> {
  const ciphertext = encryptSecret(FAKE_OPENAI_KEY);
  // Simulates a row that somehow has an unsafe base_url stored (e.g. a
  // future validation-drift bug, or a row edited directly in Postgres) --
  // polishField must independently reject it, never fetch.
  const db = makePolishDb(ciphertext, { provider: 'openai_compatible', base_url: 'https://10.0.0.5/v1', model: 'whatever' });
  // A fetch stub that WOULD succeed if ever reached -- assertSafeOutboundUrl
  // should reject BEFORE this is ever called at all.
  const { calls, fetchImpl } = stubOpenAiFetch(200, {});
  try {
    const req: PolishRequest = { field: 'summary', text: 'Raw text.' };
    await polishField(db, 'user-defense-in-depth', req, fetchImpl);
    fail('polishField (private stored base_url) -- expected a throw, none occurred');
  } catch (err) {
    if (calls.length !== 0) {
      fail('polishField (private stored base_url) -- fetch was attempted despite an unsafe stored base_url');
    } else if (err instanceof ServiceError && /openai_bad_endpoint/.test(err.message)) {
      ok('polishField -- defense-in-depth: re-validates the STORED base_url on every call, rejects before any fetch');
    } else {
      fail('polishField (private stored base_url) -- wrong error shape', err);
    }
  }
}

async function main() {
  console.log('=== 1) Anthropic request shape ===');
  await verifyAnthropicRequestShape();

  console.log('\n=== 2) OpenAI-compatible request shape ===');
  await verifyOpenAiCompatibleRequestShape();

  console.log('\n=== 3) Error mapping (both providers, curated messages, no key leakage) ===');
  await verifyErrorMapping();

  console.log('\n=== 4) setAiKey: validate-before-store (both providers, valid + invalid + SSRF-unsafe) ===');
  await verifySetAiKeyValidatesBeforeStoring();

  console.log('\n=== 4e/4f) SEC-2: setAiKey validation is rate-limited, sharing polishField\'s per-user budget ===');
  await verifySetAiKeyIsRateLimited();

  console.log('\n=== 5) polishField: SSRF defense-in-depth on every call, not just at save time ===');
  await verifyPolishFieldRevalidatesSsrfOnEveryCall();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

void main();
