// Phase 7b (M1): GET one (404 -> `{error}` maps to the repository's
// `getById` "null if not found" contract at the HttpReportsRepository
// layer, see that file) and PATCH for `/api/reports/[id]`. See
// app/api/reports/route.ts's header comment for the demo-mode-404 and
// defense-in-depth-auth-check rationale -- identical here.
//
// WP4: DELETE, added alongside the two above, template-copied from
// app/api/projects/[id]/route.ts's DELETE -- see `deleteReport`
// (lib/server/reports-service.ts) for the actual access-control story
// (owner-or-admin via `reports_delete` RLS; no admin check of this route's
// own, same defense-in-depth posture as PATCH/GET above).

import { NextResponse, type NextRequest } from 'next/server';
import { ReportPatchSchema } from '@/lib/schema/api';
import { deleteReport, getReport, updateReport } from '@/lib/server/reports-service';
import { assertBodySize, assertMutationAllowed, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const report = await getReport(supabase, id);
    // Post-review nit: a constant string, not the client-supplied `id`
    // reflected back -- no live XSS today (JSON content type + React's own
    // escaping on any eventual render), but there's no reason to echo
    // untrusted input into a response body at all.
    if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    return NextResponse.json({ report });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id] GET', userId: user.id, reportId: id });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const parsed = ReportPatchSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  // `expectedUpdatedAt` rides in the same PATCH body (see ReportPatchSchema's
  // doc comment) but is NOT a ReportCore field -- split it out here so
  // `updateReport`'s `patch` argument only ever carries real report fields.
  const { expectedUpdatedAt, ...patch } = parsed.data;

  const { id } = await params;
  try {
    const report = await updateReport(supabase, id, patch, { expectedUpdatedAt });
    return NextResponse.json({ report });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id] PATCH', userId: user.id, reportId: id });
  }
}

// WP4: DELETE takes no request body -- only the Sec-Fetch-Site half of
// assertMutationAllowed applies (requireJsonBody defaults false), same as
// app/api/projects/[id]/route.ts's DELETE.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const guardError = assertMutationAllowed(request);
  if (guardError) return guardError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    await deleteReport(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id] DELETE', userId: user.id, reportId: id });
  }
}
