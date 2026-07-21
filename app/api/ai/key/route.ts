// Phase 7c (BYOK AI field polish): GET (status) / PUT (save-or-replace) /
// DELETE (remove) for `/api/ai/key`. Copies `app/api/reports/route.ts`'s
// current shape exactly (RECONCILIATION DELTA's "handler skeleton"):
// `isAiPolishConfigured()` 404 -> `assertMutationAllowed` (CSRF) ->
// `assertBodySize`/`readJsonBody` (NEVER `request.json()`) ->
// `createServerSupabase()` + `auth.getUser()` 401 -> Zod `safeParse` ->
// service -> `handleServiceError`. Gated on `isAiPolishConfigured()`, not
// `isSupabaseConfigured()` alone (see lib/server/ai-crypto.ts) -- a missing
// `AI_BYOK_ENCRYPTION_KEY` is a distinct, non-fatal misconfiguration.
//
// This route handles the ONLY plaintext an Anthropic key ever has outside
// lib/server/ai-polish.ts's outbound fetch -- the PUT request body. It is
// NEVER logged here, in lib/server/ai-keys.ts, or in lib/server/
// ai-crypto.ts -- see each of those files' own header comments for the
// same invariant. The PUT handler also deliberately does NOT echo Zod
// `issues` back to the client on a validation failure (unlike every other
// route in this app) -- a curated message only; see that handler below.

import { NextResponse, type NextRequest } from 'next/server';
import { SetAiKeyInputSchema } from '@/lib/schema/api';
import { isAiPolishConfigured } from '@/lib/server/ai-crypto';
import { deleteAiKey, getAiKeyStatus, setAiKey } from '@/lib/server/ai-keys';
import { assertBodySize, assertMutationAllowed, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { createServerSupabase } from '@/lib/supabase/server';

// A plain `{ apiKey: string }` body, generous but nowhere near the 2 MB default `assertBodySize` cap.
const MAX_KEY_BODY_BYTES = 4 * 1024;

export async function GET() {
  if (!isAiPolishConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const status = await getAiKeyStatus(supabase);
    return NextResponse.json(status);
  } catch (err) {
    return handleServiceError(err, { route: 'api/ai/key GET', userId: user.id });
  }
}

export async function PUT(request: NextRequest) {
  if (!isAiPolishConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const guardError = assertMutationAllowed(request, { requireJsonBody: true }) ?? assertBodySize(request);
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const bodyResult = await readJsonBody(request, MAX_KEY_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = SetAiKeyInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    // Deliberately NOT `NextResponse.json({ ..., issues: parsed.error.issues })`
    // like every other route -- the parsed body carries the plaintext key,
    // and there is no reason to risk any fragment of it (or of a
    // near-miss paste) round-tripping into a client-visible issues array.
    // A generic message is enough here.
    //
    // COR-1 (post-review): this message used to say "Enter a valid
    // Anthropic API key." unconditionally -- reachable for
    // `openai_compatible` too (e.g. a `baseUrl` missing `https://` passes
    // `AiKeySection.tsx`'s client-side non-empty check but fails this
    // schema's `.url()`/`startsWith('https://')`), telling an OpenRouter/
    // Groq/etc. user to enter an "Anthropic key" -- confusing and just
    // wrong for their provider. Provider-neutral now.
    return NextResponse.json({ error: 'Check the API key, base URL, and model, then try again.' }, { status: 400 });
  }

  try {
    // NEVER log `parsed.data`/`bodyResult.data` anywhere in this function
    // or anything it calls -- see this file's header comment. `parsed.data`
    // is the full `{apiKey, provider, baseUrl?, model?}` body (BYOK
    // generalization) -- passed through verbatim, `setAiKey`
    // (lib/server/ai-keys.ts) is what dispatches to the right provider's
    // validation. `user.id` lets `setAiKey` rate-limit its validation call
    // through the SAME per-user limiter `polishField` uses (SEC-2,
    // post-review) -- an unauthenticated/unthrottled outbound-fetch
    // primitive otherwise.
    const result = await setAiKey(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return handleServiceError(err, { route: 'api/ai/key PUT', userId: user.id });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAiPolishConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // No request body -- `requireJsonBody: false`, same precedent as the
  // share-enable/revoke endpoints (app/api/reports/[id]/share/route.ts).
  const guardError = assertMutationAllowed(request, { requireJsonBody: false });
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    await deleteAiKey(supabase);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleServiceError(err, { route: 'api/ai/key DELETE', userId: user.id });
  }
}
