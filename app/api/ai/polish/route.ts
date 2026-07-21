// Phase 7c (BYOK AI field polish): POST-only `/api/ai/polish`. Same
// handler skeleton as `app/api/ai/key/route.ts` (see that file's header
// comment) -- `isAiPolishConfigured()` 404 -> `assertMutationAllowed`
// (CSRF) -> `assertBodySize`/`readJsonBody` -> `createServerSupabase()` +
// `auth.getUser()` 401 -> Zod `safeParse` -> `polishField` ->
// `handleServiceError`. `MAX_POLISH_BODY_BYTES` is a SMALL cap (~32 KB),
// not the 2 MB default -- a polish request is one bounded field (<=4,000
// chars) plus a small bounded context object, nowhere near needing more.

import { NextResponse, type NextRequest } from 'next/server';
import { PolishRequestSchema } from '@/lib/schema/api';
import { isAiPolishConfigured } from '@/lib/server/ai-crypto';
import { polishField } from '@/lib/server/ai-polish';
import { assertBodySize, assertMutationAllowed, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { createServerSupabase } from '@/lib/supabase/server';

const MAX_POLISH_BODY_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  if (!isAiPolishConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const guardError = assertMutationAllowed(request, { requireJsonBody: true }) ?? assertBodySize(request);
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const bodyResult = await readJsonBody(request, MAX_POLISH_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = PolishRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await polishField(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return handleServiceError(err, { route: 'api/ai/polish POST', userId: user.id });
  }
}
