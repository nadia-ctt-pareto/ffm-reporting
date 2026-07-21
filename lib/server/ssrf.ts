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
// DNS REBINDING / TOCTOU (SEC-3, post-review -- CLOSED, not just documented):
// resolving the hostname and validating every resolved address is only
// half the job if the caller's `fetch()` then re-resolves DNS itself a
// moment later -- a malicious/compromised DNS server could serve a public
// address for THIS validation lookup and a private address for that SECOND
// lookup, slipping through. `assertSafeOutboundUrl` now returns the exact
// address(es) it validated, and `buildPinnedDispatcher` (below) turns them
// into an undici `Agent` whose `connect.lookup` ALWAYS returns those SAME
// addresses -- no second DNS resolution ever happens, so there is no gap
// for a rebinding attacker to exploit. `lib/server/ai-polish.ts`'s
// `callOpenAiCompatible` is the one caller, and pairs this with `undici`'s
// OWN exported `fetch` (verified live: Node's GLOBAL `fetch` refuses a
// dispatcher built from a separately-installed `undici` package -- an
// `instanceof` identity check against Node's own internal, non-importable
// undici copy fails). The request's Host header and TLS SNI are still
// computed from the ORIGINAL hostname by undici's own connector (unaffected
// by this override) -- verified live against a real public host: pinning to
// the address that host actually resolved to succeeds with a normal TLS
// handshake (certificate validates against the hostname, not the IP);
// pinning to a deliberately WRONG address times out/fails, proving the
// override genuinely takes effect rather than being silently ignored.

import { promises as dns } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { Agent, type Dispatcher } from 'undici';

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

function bigIntToIpv4(v: bigint): string {
  const mask8 = BigInt(0xff);
  return [(v >> BigInt(24)) & mask8, (v >> BigInt(16)) & mask8, (v >> BigInt(8)) & mask8, v & mask8].join('.');
}

/**
 * The 96-bit `64:ff9b::/96` NAT64 prefix (RFC 6052), as an integer directly
 * comparable to `value >> 32n` (a tested address's own top-96-bits value).
 * Derived by re-running `ipv6ToBigInt` on the literal prefix itself
 * (already-tested parser, module-load-time-once) rather than hand-computing
 * the hex/bit-shift arithmetic -- less room for a silent off-by-one.
 */
const NAT64_PREFIX_TOP96 = (() => {
  const parsed = ipv6ToBigInt('64:ff9b::');
  if (parsed === null) throw new Error('lib/server/ssrf.ts: failed to parse the NAT64 prefix constant (64:ff9b::) -- this should never happen.');
  return parsed >> BigInt(32);
})();

/** The 16-bit `2002::/16` 6to4 prefix (RFC 3056), same derivation approach as `NAT64_PREFIX_TOP96` above. */
const SIX_TO_FOUR_PREFIX_TOP16 = (() => {
  const parsed = ipv6ToBigInt('2002::');
  if (parsed === null) throw new Error('lib/server/ssrf.ts: failed to parse the 6to4 prefix constant (2002::) -- this should never happen.');
  return parsed >> BigInt(112);
})();

/**
 * SEC-1 (post-review): the ORIGINAL version of this function only unwrapped
 * ONE embedded-IPv4 form -- IPv4-mapped (`::ffff:a.b.c.d`). Three OTHER
 * standard forms embed an IPv4 address inside an IPv6 address too, and each
 * is a live bypass if left unhandled (verified against this exact function,
 * pre-fix, by the reviewer):
 *   - **IPv4-compatible** (`::a.b.c.d`, `::/96`, deprecated but still a
 *     valid literal) -- e.g. `::10.0.0.1` embeds a private address.
 *   - **NAT64** (`64:ff9b::a.b.c.d`, `64:ff9b::/96`, RFC 6052) -- a NAT64
 *     gateway synthesizes exactly this shape from an IPv4 destination, so
 *     on an IPv6-only/NAT64 runtime, `64:ff9b::a9fe:a9fe` (169.254.169.254,
 *     cloud metadata) resolving via AAAA sails straight past every
 *     IPv6-specific check below unless unwrapped here -- a REAL escalation
 *     to metadata-SSRF / credential theft, not a theoretical one.
 *   - **6to4** (`2002:WWXX:YYZZ::`, `2002::/16`, RFC 3056) -- the embedded
 *     IPv4 sits at bits 16-47 (right after the fixed `2002` prefix), NOT
 *     the low 32 bits like the three forms above. 6to4 is INSIDE global
 *     unicast (`2000::/3`), so a naive "allow everything in `2000::/3`"
 *     allowlist would not have caught this either.
 * Every embedded form, once unwrapped, is checked with the SAME
 * `isPrivateIpv4` this file already uses for plain IPv4 -- one range list,
 * never duplicated.
 */
function extractEmbeddedIpv4(value: bigint): string | null {
  const mask32 = BigInt(0xffffffff);
  const top96 = value >> BigInt(32);
  if (top96 === BigInt(0xffff)) return bigIntToIpv4(value & mask32); // ::ffff:a.b.c.d -- IPv4-mapped
  if (top96 === BigInt(0)) return bigIntToIpv4(value & mask32); // ::a.b.c.d -- IPv4-compatible (also covers :: and ::1, redundant with the explicit checks below)
  if (top96 === NAT64_PREFIX_TOP96) return bigIntToIpv4(value & mask32); // 64:ff9b::a.b.c.d -- NAT64
  const top16 = value >> BigInt(112);
  if (top16 === SIX_TO_FOUR_PREFIX_TOP16) return bigIntToIpv4((value >> BigInt(80)) & mask32); // 2002:WWXX:YYZZ:: -- 6to4, embedded at bits 16-47
  return null;
}

/** True if the raw IPv6 literal falls in a private/loopback/link-local/ULA/unspecified range, OR embeds a private IPv4 address via any of the four standard forms (`extractEmbeddedIpv4` above). Fails CLOSED on anything unparsable. */
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
  const embedded = extractEmbeddedIpv4(value);
  if (embedded !== null) return isPrivateIpv4(embedded);
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
 * to ANY such address. On success, returns BOTH the parsed `URL` and the
 * exact `addresses` it validated (SEC-3, post-review) -- callers should feed
 * `addresses` into `buildPinnedDispatcher` below and `fetch()` the `url`
 * THROUGH that dispatcher, closing the DNS-rebinding gap a second,
 * independent resolution at connect time would otherwise leave open (see
 * this file's header comment). Always pair with `redirect: 'error'` too (a
 * provider cannot 3xx this server into an internal address after this
 * check passes).
 */
export async function assertSafeOutboundUrl(rawUrl: string, options: AssertSafeOutboundUrlOptions = {}): Promise<{ url: URL; addresses: string[] }> {
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

  return { url, addresses };
}

/**
 * SEC-3 (post-review): turns the EXACT address(es) `assertSafeOutboundUrl`
 * just validated into an `undici` `Agent` whose custom `connect.lookup`
 * ALWAYS returns those same addresses -- never re-resolves DNS at connect
 * time. This is what actually closes the DNS-rebinding TOCTOU (see this
 * file's header comment) -- `assertSafeOutboundUrl` alone only closes it if
 * literally nothing happens between the check and the connect, which is
 * never true for a real `fetch()` against the global dispatcher.
 *
 * The request's Host header and TLS SNI are computed by undici's own
 * connector from the URL passed to `fetch()`, NOT from anything this
 * function returns -- overriding only `connect.lookup` (not `host`/
 * `servername`) is what keeps certificate validation working normally
 * against the real hostname while still pinning which IP is actually
 * dialed. Node's `dns.LookupOptions.all` decides whether the underlying
 * `net`/`tls` connect logic wants ONE address or ALL of them (Node's own
 * Happy-Eyeballs multi-connect path requests `all: true`) -- this function
 * answers either shape from the SAME validated list, never a fresh lookup.
 *
 * MUST be used with `undici`'s own exported `fetch`, never Node's global
 * `fetch` -- verified live that the global `fetch` rejects a `dispatcher`
 * built from a separately-installed `undici` package (an `instanceof`
 * check against Node's own internal, non-importable undici copy fails).
 */
export function buildPinnedDispatcher(addresses: string[]): Dispatcher {
  if (addresses.length === 0) {
    throw new SsrfError('No validated address to connect to.');
  }
  const parsed = addresses.map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      // Should be unreachable -- every address here already passed
      // `assertSafeOutboundUrl`'s own `isIP` check. Fails closed rather
      // than silently passing a malformed literal to `net`/`tls`.
      throw new SsrfError('An internally-validated address was not a valid IP literal.');
    }
    return { address, family };
  });

  const lookup: LookupFunction = (_hostname, dnsOptions, callback) => {
    if (dnsOptions && typeof dnsOptions === 'object' && dnsOptions.all) {
      callback(null, parsed);
    } else {
      callback(null, parsed[0].address, parsed[0].family);
    }
  };

  return new Agent({ connect: { lookup } });
}
