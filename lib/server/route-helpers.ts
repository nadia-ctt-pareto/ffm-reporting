// Post-review hardening (SHOULD-FIX 5): every `app/api/**` route handler
// previously hand-rolled its own `statusForServiceError`/`errorResponse`
// pair (four near-identical copies). Consolidated here so the two fixes
// below apply uniformly instead of needing four independent edits:
//   1. Every `ServiceError` is now logged server-side (`logServiceError`,
//      lib/server/reports-service.ts) BEFORE the response is built -- the
//      old per-file `errorResponse` checked `instanceof ServiceError` first
//      and returned without logging, so 401/403/404/409/400 (exactly the
//      security-relevant events -- a non-owner PATCH, a duplicate-key
//      conflict) were invisible in server logs.
//   2. A genuinely UNEXPECTED throw (not a `ServiceError` -- a bug, a
//      network blip talking to Supabase, anything `mapPgError` didn't
//      already normalize) maps to HTTP 500 with a fixed generic message,
//      never a raw `err.message` -- an un-normalized `Error` might contain
//      anything.
//
// Post-review hardening round 2 (SHOULD-FIX D): the comment above USED TO
// assert that `ServiceError.message` is ALWAYS the curated, safe-to-return
// string, so returning it verbatim below was safe. That assertion was
// false -- five call sites in `reports-service.ts` (`mapRow`,
// `updateReport`, `enableShare`, `getSharedReport`, `ensureProject`)
// constructed a `ServiceError` directly with internal diagnostic detail (a
// raw schema-drift message) or a client-reflected value (an id echoed
// straight into the message), never routed through `curatedMessage`. One of
// those -- `mapRow`'s message -- is exactly what BLOCKER A's exploit
// surfaced to the client. Patching those five call sites individually was
// considered and rejected: that fix regresses silently the next time
// someone adds a sixth direct `ServiceError` construction. The structural
// fix instead: `handleServiceError` below is now the SINGLE place that
// decides what a client sees, calling `curatedMessage` UNCONDITIONALLY over
// every `ServiceError.message`, regardless of what that message actually
// contains. Every message on a `ServiceError` in this codebase should now
// be treated as internal/diagnostic-only, useful for `logServiceError`
// below and nothing else -- see `curatedMessage`'s own doc comment
// (reports-service.ts) for why it isn't ALSO applied at construction time
// (double-curating a message that already went through `curatedMessage`
// once, e.g. inside `mapPgError`, can silently downgrade a precise message
// to the generic default for its `code`).

import { NextResponse } from 'next/server';
import { ServiceError, curatedMessage, logServiceError, type ServiceErrorCode } from './reports-service';

function statusForServiceError(code: ServiceErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'invalid':
      return 400;
    case 'internal':
    default:
      return 500;
  }
}

export interface ServiceErrorContext {
  /** Which route handler this came from -- e.g. `'api/reports'`, `'api/reports/[id]/share'`. Logged, never returned to the client. */
  route: string;
  userId?: string;
  reportId?: string;
}

/** The one place every route handler's `catch` block should call. See header comment. */
export function handleServiceError(err: unknown, context: ServiceErrorContext): NextResponse {
  if (err instanceof ServiceError) {
    logServiceError(err, context);
    // SHOULD-FIX D (post-review round 2): `curatedMessage` runs HERE,
    // unconditionally -- see this file's header comment for why this
    // replaced trusting `err.message` was already curated.
    return NextResponse.json({ error: curatedMessage(err.code, err.message) }, { status: statusForServiceError(err.code) });
  }
  // Deliberate server-side log for a genuinely unexpected (non-ServiceError) throw.
  console.error(`[${context.route}] unexpected error`, err);
  return NextResponse.json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 });
}
