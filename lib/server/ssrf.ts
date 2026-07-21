// BYOK generalization: SSRF (server-side request forgery) hardening for the
// `openai_compatible` provider. That provider's `base_url` is USER-CONTROLLED
// (unlike `anthropic` mode, whose base is the fixed `https://api.anthropic.com`
// constant in lib/server/ai-polish.ts -- never user input, so none of this
// module applies there) and this server makes an outbound fetch to it, both
// when a key is saved (`lib/server/ai-keys.ts`'s `setAiKey` ->
// `validateOpenAiCompatibleKey`) and on every polish call
// (`lib/server/ai-polish.ts`'s `callOpenAiCompatible`) -- see both call
// sites for how this module is used.
//
// THREAT MODEL: without this, any authenticated user could point this
// app's own outbound fetch at an internal service (localhost, a private-
// network peer this server can reach, a cloud metadata endpoint) by simply
// saving that address as their `base_url`, then read back whatever that
// internal endpoint returns through the "polish" response -- a classic
// SSRF-to-data-exfiltration chain. `assertSafeOutboundUrl` below is the
// ONE place this is checked; both call sites above call it (defense-in-
// depth: even if the stored `base_url` somehow bypassed validation at save
// time -- a future bug, or a row edited directly in Postgres -- the polish
// call re-validates it independently).
//
// RESIDUAL RISK (documented, not solved -- DNS rebinding / TOCTOU): this
// function resolves the hostname and validates every resolved address
// IMMEDIATELY before the caller is expected to `fetch()` the same URL --
// but Node's global `fetch` (undici) performs its OWN DNS resolution when
// it actually opens the connection, a moment later. A malicious/compromised
// DNS server could serve a public address for THIS validation lookup and a
// private address for undici's lookup moments after, slipping through.
// Fully closing this would require pinning the validated IP into the
// connection itself (e.g. a custom undici `Agent` with a `connect.lookup`
// override that reuses the same resolved address) -- not implemented here.
// "Resolve-and-validate immediately before the fetch, reject on private
// results" is the documented, honest mitigation this module provides: it
// closes the overwhelmingly common case (a `base_url` that is, or that
// plainly resolves to, an internal/reserved address at rest) without
// pretending to close a live-attacker DNS-rebinding race. Every call site
// also passes `redirect: 'error'` to its own `fetch()` call (a provider
// cannot 3xx this server into an internal address after this check passes
// -- see lib/server/ai-polish.ts).

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Thrown by `assertSafeOutboundUrl` for ANY rejection -- wrong scheme, a
 * disallowed/reserved host, or a DNS resolution failure. `.message` is
 * always a fixed, safe-to-return string (never echoes back attacker-
 * controlled input beyond the hostname itself, and never any credential) --
 * callers may surface it directly to the user (see
 * `lib/server/ai-polish.ts`'s `openai_bad_endpoint` marker mapping).
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Known cloud-metadata hosts -- reachable only from inside a cloud VM/
 * container's own network, never a legitimate LLM-provider endpoint. Kept
 * as an explicit hostname denylist ON TOP OF the IP-range checks below
 * because `169.254.169.254` is already covered by the `169.254.0.0/16`
 * link-local range (defense-in-depth, redundant on purpose), while
 * `metadata.google.internal` is a HOSTNAME with no IP-literal form to catch
 * that way -- it must be blocked by name, before any DNS resolution even
 * happens (GCP's own metadata server otherwise resolves it to a normal-
 * looking address from inside a GCE VM).
 */
const METADATA_HOSTNAMES = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata.google.internal.']);

/** True if the raw IPv4 literal (already validated by `net.isIP`) falls in a private/loopback/link-local/CGNAT/reserved range. Fails CLOSED (treats malformed input as private) -- this is a rejection-only predicate, never the sole gate for "is this safe". */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 -- loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 -- link-local, incl. cloud metadata's 169.254.169.254
  if (a === 0) return true; // 0.0.0.0/8 -- "this network" / unspecified, IANA reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 -- CGNAT (RFC 6598)
  return false;
}

/**
 * Parses a bare IPv6 literal (no brackets, no zone id -- already validated
 * by `net.isIP`) into its 128-bit value as a `bigint`, handling `::`
 * compression and a trailing IPv4-mapped/-compatible dotted-quad (e.g.
 * `::ffff:127.0.0.1`). Returns `null` for anything that doesn't parse
 * cleanly -- treated as "private" (fail closed) by the caller below.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  const doubleColonIdx = ip.indexOf('::');
  const head = doubleColonIdx === -1 ? ip : ip.slice(0, doubleColonIdx);
  const tail = doubleColonIdx === -1 ? '' : ip.slice(doubleColonIdx + 2);
  const headParts = head.length > 0 ? head.split(':') : [];
  const tailParts = tail.length > 0 ? tail.split(':') : [];

  function expandTrailingV4(parts: string[]): string[] | null {
    if (parts.length === 0) return parts;
    const last = parts[parts.length - 1];
    if (!last.includes('.')) return parts;
    const octets = last.split('.').map((o) => Number(o));
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    return [...parts.slice(0, -1), hi, lo];
  }

  const expandedHead = expandTrailingV4(headParts);
  const expandedTail = expandTrailingV4(tailParts);
  if (expandedHead === null || expandedTail === null) return null;

  const totalGroups = expandedHead.length + expandedTail.length;
  if (doubleColonIdx === -1 && totalGroups !== 8) return null; // no compression -- must be exactly 8 groups
  if (doubleColonIdx !== -1 && totalGroups > 8) return null;
  const missing = 8 - totalGroups;
  const middle = doubleColonIdx !== -1 ? new Array(missing).fill('0') : [];
  const allGroups = [...expandedHead, ...middle, ...expandedTail];
  if (allGroups.length !== 8) return null;

  // `BigInt(n)` calls, not `123n` literal syntax -- this project's
  // `tsconfig.json` targets ES2017 (a broader compatibility choice made
  // well before this module existed), and TypeScript rejects BigInt LITERAL
  // syntax below `target: ES2020` even though the `bigint` type itself, and
  // every operator used on it below, type-checks fine against this
  // project's `"lib": [..., "esnext"]` -- verified live (`npm run
  // typecheck`). Runtime behavior is identical either way; Node's BigInt
  // support does not depend on the TS compile target at all.
  let result = BigInt(0);
  const SIXTEEN = BigInt(16);
  for (const g of allGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    result = (result << SIXTEEN) | BigInt(parseInt(g, 16));
  }
  return result;
}

/** True if the raw IPv6 literal falls in a private/loopback/link-local/ULA/unspecified range, OR is an IPv4-mapped (`::ffff:0:0/96`) address wrapping a private IPv4. Fails CLOSED on anything unparsable. */
function isPrivateIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  if (value === null) return true;
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  if (value === ZERO) return true; // :: -- unspecified
  if (value === ONE) return true; // ::1 -- loopback
  const top10 = value >> BigInt(118); // fe80::/10 -- link-local
  if (top10 === BigInt(0b1111111010)) return true;
  const top7 = value >> BigInt(121); // fc00::/7 -- unique local (ULA)
  if (top7 === BigInt(0b1111110)) return true;
  const top96 = value >> BigInt(32); // ::ffff:0:0/96 -- IPv4-mapped
  if (top96 === BigInt(0xffff)) {
    const mask8 = BigInt(0xff);
    const low32 = value & BigInt(0xffffffff);
    const ipv4 = [(low32 >> BigInt(24)) & mask8, (low32 >> BigInt(16)) & mask8, (low32 >> BigInt(8)) & mask8, low32 & mask8].join('.');
    return isPrivateIpv4(ipv4);
  }
  return false;
}

/** A single resolved address, shaped to match the one property of Node's `dns.lookup(..., {all: true})` result this module actually needs. */
export interface ResolvedAddress {
  address: string;
}

export interface AssertSafeOutboundUrlOptions {
  /**
   * Test-only DNS resolver override -- defaults to `dns.promises.lookup(hostname,
   * {all: true})`. Lets `scripts/verify-ssrf.ts` exercise the "a hostname
   * that resolves to a private IP" case deterministically (no real DNS
   * record needs to exist for the test to be meaningful) without touching
   * this function's production code path.
   */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

/**
 * The one SSRF gate for a user-controlled outbound URL. Throws `SsrfError`
 * (never returns) for: a non-`https:` scheme; `localhost`/`*.localhost`; a
 * known cloud-metadata hostname; an IP-literal host in a private/loopback/
 * link-local/ULA/CGNAT/reserved range; or a hostname that RESOLVES (via DNS)
 * to ANY such address. Returns the parsed `URL` on success -- callers should
 * `fetch()` that same `URL` object immediately afterward (see this file's
 * header comment for the residual DNS-rebinding risk that ordering does,
 * and does not, close), always with `redirect: 'error'`.
 */
export async function assertSafeOutboundUrl(rawUrl: string, options: AssertSafeOutboundUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('This is not a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new SsrfError('Only https:// URLs are allowed.');
  }

  // VERIFIED GOTCHA: `URL#hostname` -- unlike what its name suggests --
  // KEEPS the `[...]` brackets for an IPv6 literal (e.g. `"[::1]"`, not
  // `"::1"`) -- only `URL#host`/`href` documented that; `hostname` doing
  // the same is easy to assume away and get wrong. `net.isIP('[::1]')`
  // returns `0` (not recognized as any IP version) with the brackets still
  // attached, which would have silently routed every IPv6 literal host
  // through the DNS-lookup branch below instead of the direct-literal-check
  // branch -- caught here by stripping the brackets before anything else
  // touches `hostname`. `URL#hostname` does still lowercase everything, so
  // no further normalization is needed beyond this.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfError('This host is not allowed.');
  }
  if (METADATA_HOSTNAMES.has(hostname)) {
    throw new SsrfError('This host is not allowed.');
  }

  const literalVersion = isIP(hostname);
  const addresses: string[] = [];
  if (literalVersion !== 0) {
    // The host IS an IP literal -- nothing to resolve, check it directly.
    addresses.push(hostname);
  } else {
    const lookup = options.lookup ?? ((h: string) => dns.lookup(h, { all: true }));
    let resolved: ResolvedAddress[];
    try {
      resolved = await lookup(hostname);
    } catch {
      throw new SsrfError("This host couldn't be resolved.");
    }
    if (resolved.length === 0) {
      throw new SsrfError("This host couldn't be resolved.");
    }
    for (const r of resolved) addresses.push(r.address);
  }

  for (const address of addresses) {
    if (METADATA_HOSTNAMES.has(address)) {
      throw new SsrfError('This host is not allowed.');
    }
    const version = isIP(address);
    if (version === 4 && isPrivateIpv4(address)) {
      throw new SsrfError('This host resolves to a private or reserved address, which is not allowed.');
    }
    if (version === 6 && isPrivateIpv6(address)) {
      throw new SsrfError('This host resolves to a private or reserved address, which is not allowed.');
    }
  }

  return url;
}
