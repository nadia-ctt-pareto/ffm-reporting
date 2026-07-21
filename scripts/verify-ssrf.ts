// Ad-hoc verification harness for lib/server/ssrf.ts's assertSafeOutboundUrl
// -- this project has no jest/vitest (see package.json's "scripts"), so
// this follows the same convention as scripts/check-mcp-tool-contract.ts:
// a plain tsx script with explicit PASS/FAIL assertions, exit code 1 on any
// failure.
//
// Run: npx tsx scripts/verify-ssrf.ts
//
// Requires real network access for the ONE "a normal public host passes"
// case (a real DNS lookup against a real hostname) -- everything else is
// either a literal IP/host (no DNS at all) or uses an injected fake
// resolver (see AssertSafeOutboundUrlOptions.lookup) so it never touches
// the network.

import { assertSafeOutboundUrl, buildPinnedDispatcher, SsrfError } from '../lib/server/ssrf';

let passed = 0;
let failed = 0;

async function expectRejects(label: string, url: string, opts?: Parameters<typeof assertSafeOutboundUrl>[1]): Promise<void> {
  try {
    const result = await assertSafeOutboundUrl(url, opts);
    failed += 1;
    console.error(`FAIL: ${label} -- expected rejection, got a resolved URL: ${result.url.href} (addresses: ${result.addresses.join(', ')})`);
  } catch (err) {
    if (err instanceof SsrfError) {
      passed += 1;
      console.log(`OK:   ${label} -- rejected (${err.message})`);
    } else {
      failed += 1;
      console.error(`FAIL: ${label} -- rejected, but with the WRONG error type:`, err);
    }
  }
}

async function expectResolves(label: string, url: string, opts?: Parameters<typeof assertSafeOutboundUrl>[1]): Promise<void> {
  try {
    const result = await assertSafeOutboundUrl(url, opts);
    passed += 1;
    console.log(`OK:   ${label} -- resolved (${result.url.href}, addresses: ${result.addresses.join(', ')})`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${label} -- expected to resolve, but was rejected:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  console.log('=== assertSafeOutboundUrl: scheme + literal-host rejections ===');
  await expectRejects('http:// (wrong scheme)', 'http://openrouter.ai/api/v1');
  await expectRejects('ftp:// (wrong scheme)', 'ftp://openrouter.ai/api/v1');
  await expectRejects('https://localhost', 'https://localhost/api');
  await expectRejects('https://foo.localhost', 'https://foo.localhost/api');
  await expectRejects('https://127.0.0.1 (loopback)', 'https://127.0.0.1/api');
  await expectRejects('https://127.0.0.5 (loopback range)', 'https://127.0.0.5/api');
  await expectRejects('https://10.0.0.1 (10/8)', 'https://10.0.0.1/api');
  await expectRejects('https://172.16.0.5 (172.16/12)', 'https://172.16.0.5/api');
  await expectRejects('https://172.31.255.255 (172.16/12 upper bound)', 'https://172.31.255.255/api');
  await expectResolves('https://172.32.0.1 (JUST outside 172.16/12 -- must NOT be blocked)', 'https://172.32.0.1/api');
  await expectRejects('https://192.168.1.1 (192.168/16)', 'https://192.168.1.1/api');
  await expectRejects('https://169.254.169.254 (cloud metadata / link-local)', 'https://169.254.169.254/latest/meta-data');
  await expectRejects('https://169.254.1.1 (link-local range)', 'https://169.254.1.1/api');
  await expectRejects('https://0.0.0.0', 'https://0.0.0.0/api');
  await expectRejects('https://100.64.0.1 (CGNAT)', 'https://100.64.0.1/api');
  await expectRejects('https://100.127.255.255 (CGNAT upper bound)', 'https://100.127.255.255/api');
  await expectResolves('https://100.128.0.1 (JUST outside CGNAT -- must NOT be blocked)', 'https://100.128.0.1/api');
  await expectRejects('https://metadata.google.internal', 'https://metadata.google.internal/computeMetadata/v1/');
  await expectRejects('https://metadata.google.internal. (trailing dot, FQDN)', 'https://metadata.google.internal./computeMetadata/v1/');

  console.log('\n=== assertSafeOutboundUrl: IPv6 literal-host rejections ===');
  await expectRejects('https://[::1] (loopback)', 'https://[::1]/api');
  await expectRejects('https://[::] (unspecified)', 'https://[::]/api');
  await expectRejects('https://[fe80::1] (link-local fe80::/10)', 'https://[fe80::1]/api');
  await expectRejects('https://[febf::1] (link-local fe80::/10 upper bound)', 'https://[febf::1]/api');
  await expectResolves('https://[fec0::1] (JUST outside fe80::/10 -- must NOT be blocked)', 'https://[fec0::1]/api');
  await expectRejects('https://[fc00::1] (ULA fc00::/7)', 'https://[fc00::1]/api');
  await expectRejects('https://[fd12:3456::1] (ULA fc00::/7)', 'https://[fd12:3456::1]/api');
  await expectRejects('https://[fdff:ffff::1] (ULA fc00::/7 upper bound)', 'https://[fdff:ffff::1]/api');
  await expectResolves('https://[fe00::1] (JUST outside fc00::/7 -- must NOT be blocked)', 'https://[fe00::1]/api');
  await expectRejects('https://[::ffff:127.0.0.1] (IPv4-mapped loopback)', 'https://[::ffff:127.0.0.1]/api');
  await expectRejects('https://[::ffff:10.1.2.3] (IPv4-mapped private)', 'https://[::ffff:10.1.2.3]/api');
  await expectResolves('https://[2001:4860:4860::8888] (a real public IPv6 -- Google DNS -- must NOT be blocked)', 'https://[2001:4860:4860::8888]/api');

  console.log('\n=== assertSafeOutboundUrl: IPv6 embedded-IPv4 forms beyond IPv4-mapped (SEC-1 post-review) ===');
  // 64:ff9b::/96 -- NAT64 (RFC 6052). A NAT64 gateway synthesizes exactly
  // this shape from an IPv4 destination -- 64:ff9b::a9fe:a9fe embeds
  // 169.254.169.254 (cloud metadata). Reviewer-supplied case: on an
  // IPv6-only/NAT64 runtime, an attacker's malicious AAAA record resolving
  // to this address would have sailed straight past every other check.
  await expectRejects('https://[64:ff9b::a9fe:a9fe] (NAT64 embedding 169.254.169.254 -- cloud metadata)', 'https://[64:ff9b::a9fe:a9fe]/api');
  await expectResolves('https://[64:ff9c::a9fe:a9fe] (JUST outside the NAT64 prefix -- must NOT be blocked)', 'https://[64:ff9c::a9fe:a9fe]/api');
  // ::/96 -- IPv4-compatible (deprecated but still a valid literal).
  // Reviewer-supplied case: ::a00:1 embeds 10.0.0.1.
  await expectRejects('https://[::a00:1] (IPv4-compatible embedding 10.0.0.1)', 'https://[::a00:1]/api');
  await expectRejects('https://[::7f00:1] (IPv4-compatible embedding 127.0.0.1)', 'https://[::7f00:1]/api');
  // 2002::/16 -- 6to4 (RFC 3056). The embedded IPv4 sits at bits 16-47, NOT
  // the low 32 bits -- and 6to4 is INSIDE global unicast (2000::/3), so a
  // naive "allow 2000::/3" allowlist would NOT catch this. Reviewer-supplied
  // case: 2002:7f00:1:: embeds 127.0.0.1.
  await expectRejects('https://[2002:7f00:1::] (6to4 embedding 127.0.0.1)', 'https://[2002:7f00:1::]/api');
  await expectRejects('https://[2002:a00:1::] (6to4 embedding 10.0.0.1)', 'https://[2002:a00:1::]/api');
  await expectResolves('https://[2003:7f00:1::] (JUST outside the 6to4 prefix 2002::/16 -- must NOT be blocked)', 'https://[2003:7f00:1::]/api');

  console.log('\n=== assertSafeOutboundUrl: the same three embedded-IPv4 forms, via a RESOLVED AAAA (injected resolver, not a literal host) ===');
  await expectRejects('a hostname whose AAAA resolves to a NAT64-embedded 169.254.169.254', 'https://nat64-metadata.example.test/api', {
    lookup: async () => [{ address: '64:ff9b::a9fe:a9fe' }],
  });
  await expectRejects('a hostname whose AAAA resolves to an IPv4-compatible-embedded 10.0.0.1', 'https://v4compat.example.test/api', {
    lookup: async () => [{ address: '::a00:1' }],
  });
  await expectRejects('a hostname whose AAAA resolves to a 6to4-embedded 127.0.0.1', 'https://sixtofour.example.test/api', {
    lookup: async () => [{ address: '2002:7f00:1::' }],
  });

  console.log('\n=== assertSafeOutboundUrl: a hostname that RESOLVES to a private IP (injected DNS resolver) ===');
  await expectRejects('https://internal.example.test resolving to 10.1.2.3', 'https://internal.example.test/api', {
    lookup: async () => [{ address: '10.1.2.3' }],
  });
  await expectRejects('https://internal.example.test resolving to a MIX of public+private (any private address rejects)', 'https://internal.example.test/api', {
    lookup: async () => [
      { address: '203.0.113.5' },
      { address: '192.168.0.9' },
    ],
  });
  await expectResolves('https://public.example.test resolving to ONLY public addresses', 'https://public.example.test/api', {
    lookup: async () => [{ address: '203.0.113.5' }],
  });
  await expectRejects('a hostname whose DNS lookup itself fails', 'https://this-will-not-resolve.example.test/api', {
    lookup: async () => {
      throw new Error('ENOTFOUND (simulated)');
    },
  });

  console.log('\n=== assertSafeOutboundUrl: a normal public host (REAL DNS, no injected resolver) ===');
  await expectResolves('https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1');

  console.log('\n=== redirect: "error" fetch behavior (the mechanism callOpenAiCompatible/callAnthropic rely on to reject a redirect-to-internal) ===');
  await verifyRedirectErrorFetchBehavior();

  console.log('\n=== SEC-3: buildPinnedDispatcher actually pins the connection (closes the DNS-rebinding TOCTOU) ===');
  await verifyPinnedDispatcherClosesRebinding();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

/**
 * `assertSafeOutboundUrl` itself only validates a URL BEFORE the fetch --
 * the "no redirects" defense (a provider 3xx-ing this server into an
 * internal address AFTER validation passes) is enforced by the SEPARATE
 * `redirect: 'error'` fetch option every outbound call in
 * lib/server/ai-polish.ts passes. This spins up two throwaway local HTTP
 * servers (loopback only, no external network) to prove that mechanism
 * actually rejects a redirect, end to end, using Node's real global
 * `fetch` -- not a stub.
 */
async function verifyRedirectErrorFetchBehavior(): Promise<void> {
  const { createServer } = await import('node:http');

  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('internal-secret');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetAddr = target.address();
  if (!targetAddr || typeof targetAddr === 'string') throw new Error('unexpected server address');
  const targetUrl = `http://127.0.0.1:${targetAddr.port}/`;

  const redirector = createServer((_req, res) => {
    res.writeHead(302, { location: targetUrl });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
  const redirectorAddr = redirector.address();
  if (!redirectorAddr || typeof redirectorAddr === 'string') throw new Error('unexpected server address');
  const redirectorUrl = `http://127.0.0.1:${redirectorAddr.port}/`;

  try {
    await fetch(redirectorUrl, { redirect: 'error' });
    failed += 1;
    console.error('FAIL: redirect: "error" fetch -- expected the redirect to be rejected, but it resolved.');
  } catch {
    passed += 1;
    console.log('OK:   redirect: "error" fetch -- a 302 to an internal address was rejected (fetch threw), matching what callOpenAiCompatible/callAnthropic rely on.');
  } finally {
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await new Promise<void>((resolve) => redirector.close(() => resolve()));
  }
}

/**
 * `buildPinnedDispatcher` is the mechanism that closes the DNS-rebinding
 * TOCTOU `assertSafeOutboundUrl` alone cannot (see lib/server/ssrf.ts's
 * header comment): a validate-then-fetch WITHOUT pinning would, on a fresh
 * `fetch()` DNS lookup, trust whatever DNS answers a SECOND time -- a
 * rebinding attacker's whole play is making that second answer differ from
 * the first. Two real, network-backed checks prove the pin genuinely
 * controls what gets dialed (not merely documented as intent):
 *   1. Pin to the SAME address a real host actually resolved to -> must
 *      succeed with a normal TLS handshake (SNI/Host/cert validation are
 *      unaffected by the pin -- only `connect.lookup` is overridden).
 *   2. Pin to a DELIBERATELY WRONG address -> must fail/time out. If the
 *      pin were a no-op (silently falling back to a fresh, real DNS
 *      lookup), this would succeed anyway -- it not succeeding is the
 *      actual proof the override takes effect, which is exactly the
 *      property that closes the rebinding race: whatever address
 *      `assertSafeOutboundUrl` validated is unconditionally what gets
 *      dialed, never a second, independently-resolved answer.
 */
async function verifyPinnedDispatcherClosesRebinding(): Promise<void> {
  const { url, addresses } = await assertSafeOutboundUrl('https://openrouter.ai/api/v1');
  console.log(`  (validated addresses for openrouter.ai: ${addresses.join(', ')})`);

  const { fetch: undiciFetch } = await import('undici');

  try {
    const correctDispatcher = buildPinnedDispatcher(addresses);
    const res = await undiciFetch(url, { method: 'GET', dispatcher: correctDispatcher, signal: AbortSignal.timeout(10_000) });
    passed += 1;
    console.log(`OK:   pinning to the SAME address openrouter.ai actually resolved to succeeds (status ${res.status}) -- SNI/cert validation unaffected by the pin.`);
  } catch (err) {
    failed += 1;
    console.error('FAIL: pinning to the correct, real address should have succeeded:', err instanceof Error ? err.message : err);
  }

  try {
    const wrongDispatcher = buildPinnedDispatcher(['203.0.113.1']); // TEST-NET-3 (RFC 5737) -- guaranteed non-routable/unreachable
    await undiciFetch(url, { method: 'GET', dispatcher: wrongDispatcher, signal: AbortSignal.timeout(5_000) });
    failed += 1;
    console.error('FAIL: pinning to a deliberately WRONG address unexpectedly succeeded -- the pin is not actually taking effect.');
  } catch {
    passed += 1;
    console.log('OK:   pinning to a deliberately WRONG address fails (times out/errors) -- proves the override genuinely controls the connection, not a silent fallback to fresh DNS.');
  }
}

void main();
