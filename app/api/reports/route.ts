// Phase 7b (M1): GET (list, `?kind=weekly|daily`) and POST (batch upsert --
// `HttpReportsRepository.upsert`/`upsertMany` both land here, see that
// file) for `/api/reports`. `isSupabaseConfigured()` is checked FIRST and
// unconditionally: this whole route conceptually doesn't exist in demo
// mode (no Postgres to talk to), so it 404s rather than attempting to
// construct a Supabase client with missing env vars.
//
// `middleware.ts` turns an unauthenticated request to any `/api/*` path
// into a 401 JSON response before it ever reaches this file -- post-review
// hardening (SHOULD-FIX 6) made this a HARD guarantee (an explicit
// `/api/:path*` matcher entry, so no static-extension-shaped `/api/*` path
// like `/api/reports/x.json` can ever skip the middleware -- see
// middleware.ts's `config.matcher`). The `auth.getUser()` check below is
// still real defense-in-depth (a stable, explicit 401 contract for this
// route even if that middleware behavior ever changes), not the ONLY gate,
// but it is no longer the only thing standing between an anonymous request
// and this handler for every possible path shape.

import { NextResponse, type NextRequest } from 'next/server';
import { UpsertReportsRequestSchema } from '@/lib/schema/api';
import { listReports, upsertReports } from '@/lib/server/reports-service';
import { assertBodySize, assertMutationAllowed, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const kindParam = request.nextUrl.searchParams.get('kind');
  if (kindParam !== null && kindParam !== 'weekly' && kindParam !== 'daily') {
    return NextResponse.json({ error: "'kind' must be 'weekly' or 'daily' if present." }, { status: 400 });
  }

  try {
    const reports = await listReports(supabase, kindParam ?? undefined);
    return NextResponse.json({ reports });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports GET', userId: user.id });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const guardError = assertMutationAllowed(request, { requireJsonBody: true }) ?? assertBodySize(request);
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = UpsertReportsRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await upsertReports(supabase, parsed.data.reports, { skipExisting: parsed.data.skipExisting });
    return NextResponse.json(result);
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports POST', userId: user.id });
  }
}
