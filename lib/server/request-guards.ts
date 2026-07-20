// Post-review hardening (SHOULD-FIX 7 and 8): shared request-shape guards
// every mutating `app/api/**` route handler runs BEFORE touching Supabase or
// the request body. Server-only by convention, same as the rest of
// `lib/server/*`.

import { NextResponse, type NextRequest } from 'next/server';

/**
 * SHOULD-FIX 7 (CSRF): every mutating handler is cookie-authenticated
 * (`@supabase/ssr`'s session cookie) and reads its body via
 * `request.json()`, which parses regardless of `Content-Type`. Nothing
 * previously validated `Origin`/`Sec-Fetch-Site`/`Content-Type` -- the ONLY
 * thing standing between that and a cross-site `<form
 * enctype="text/plain">` POST silently creating/overwriting a signed-in
 * victim's reports was `sameSite: 'lax'` on the Supabase session cookie, an
 * UPSTREAM `@supabase/ssr` default (`DEFAULT_COOKIE_OPTIONS`) this repo
 * never asserted, pinned, or tested. This makes the property explicit
 * rather than silently inherited.
 *
 * Two independent checks:
 *   1. `Sec-Fetch-Site` -- sent by every modern browser (Chrome/Firefox/
 *      Safari all ship Fetch Metadata) on every request. A MISSING header
 *      (an older browser, or a non-browser client -- curl, a future Phase 8
 *      MCP tool using a bearer token instead of cookies) is NOT rejected on
 *      that basis alone -- only a header that's actually PRESENT and says
 *      something other than same-origin is a signal worth trusting; its
 *      absence is not evidence of anything.
 *
 *      Post-review hardening round 2 (SHOULD-FIX E): switched from a
 *      DENY-list (reject only the literal `cross-site`) to an ALLOW-list
 *      (`same-origin` or `none` only). `same-site` used to pass through
 *      unrejected -- verified live (it reached the RPC and returned the
 *      ownership 403, not this guard's 403). On a CUSTOM domain, a
 *      compromised or attacker-registrable SIBLING subdomain (anything
 *      under the same registrable domain) sends `Sec-Fetch-Site:
 *      same-site`, and `SameSite=Lax` session cookies ride along with it --
 *      so subdomain-origin CSRF was unmitigated there. `*.vercel.app` is on
 *      the Public Suffix List, so THIS app's own preview deploys were never
 *      actually at risk (a `*.vercel.app` sibling is genuinely
 *      `cross-site`, already rejected before this fix) -- but a future
 *      custom-domain deploy would have been. `none` (a top-level navigation
 *      not triggered by a webpage -- a typed URL, a bookmark) is allowed
 *      alongside `same-origin`: this app's own `fetch()` calls always send
 *      `same-origin`, never `none`, so allowing `none` too costs nothing
 *      for a mutating endpoint in practice, and is the standard Fetch
 *      Metadata allow-list pairing.
 *   2. `Content-Type` (only when `requireJsonBody` -- see below) -- must be
 *      `application/json`. This app's own client code (`HttpReportsRepository
 *      .request()`) always sends it; a cross-site `<form>` POST cannot set
 *      an arbitrary `Content-Type` without triggering a CORS preflight,
 *      which this API never opts into (no `Access-Control-Allow-*`
 *      response headers anywhere), so `text/plain`/`multipart/form-data`/
 *      `application/x-www-form-urlencoded` bodies -- the shapes a plain
 *      HTML `<form>` CAN send cross-site without a preflight -- are
 *      refused outright.
 *
 * `requireJsonBody` is `false` for the share-enable/revoke endpoints (POST/
 * DELETE `/api/reports/[id]/share`), which take no request body at all --
 * the Sec-Fetch-Site check alone still applies to them.
 */
export function assertMutationAllowed(request: NextRequest, options?: { requireJsonBody?: boolean }): NextResponse | null {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted.' }, { status: 403 });
  }
  if (options?.requireJsonBody) {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 });
    }
  }
  return null;
}

/**
 * SHOULD-FIX 8 (unbounded request bodies): `request.json()` buffers the
 * WHOLE body before Zod ever gets to reject it, and Next 15 Route Handlers
 * on the Node runtime have NO default body size limit (`bodyParser
 * .sizeLimit` is a Pages-API-only setting). `Content-Length` is
 * best-effort, not a hard guarantee (a chunked-transfer request can omit
 * it, or lie) -- this is cheap, early defense-in-depth that rejects an
 * obviously-oversized request BEFORE spending anything on it AT ALL (not
 * even starting to read the stream). `UpsertReportsRequestSchema`'s own
 * `.max()` bounds (lib/schema/api.ts, lib/schema/report.ts) are the real,
 * unconditional backstop for what gets PERSISTED -- but, per SHOULD-FIX F
 * below, NOT for memory, since they only run after the whole body is
 * already buffered.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB -- generous for a single report or a small batch, far below Vercel's ~4.5 MB function-payload ceiling.

export function assertBodySize(request: NextRequest): NextResponse | null {
  const raw = request.headers.get('content-length');
  const contentLength = raw ? Number(raw) : NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });
  }
  return null;
}

/**
 * Post-review hardening round 2 (SHOULD-FIX F): `assertBodySize` above only
 * ever looks at the `Content-Length` header -- a `Transfer-Encoding:
 * chunked` request can omit it entirely (or lie), skipping that guard
 * outright while a plain `request.json()` still buffers the WHOLE body in
 * memory before Zod ever gets a chance to reject it. Verified live before
 * this fix: a 3 MB chunked-encoded body sailed straight past
 * `assertBodySize` and was fully buffered. This function is the actual,
 * unconditional backstop for MEMORY (as opposed to `UpsertReportsRequestSchema`'s
 * `.max()` bounds, the backstop for what gets PERSISTED, which still only
 * runs after the fact): it reads the body as a stream, counting bytes as
 * they arrive, and aborts BEFORE accumulating past `maxBytes`, regardless
 * of `Content-Length` or `Transfer-Encoding`. Every mutating route handler
 * uses this INSTEAD OF `request.json()` (still calling `assertBodySize`
 * first too -- a well-formed, already-oversized `Content-Length` lets a
 * handler reject without even starting a stream read).
 */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  const invalidJson = () => ({ ok: false as const, response: NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 }) });
  const tooLarge = () => ({ ok: false as const, response: NextResponse.json({ error: 'Request body too large.' }, { status: 413 }) });

  if (!request.body) {
    // No body stream at all (e.g. an empty POST) -- `request.json()` throws
    // on that anyway, which is the standard "must be valid JSON" 400.
    try {
      return { ok: true, data: await request.json() };
    } catch {
      return invalidJson();
    }
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return invalidJson();
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return invalidJson();
  }
}
