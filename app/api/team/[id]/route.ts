// WP1: PATCH (rename) + DELETE for `/api/team/[id]`. Both are admin-only at
// the RLS layer (`team_members_update`/`team_members_delete`, supabase/
// migrations/20260726000016_team_members.sql). Cloned from
// app/api/projects/[id]/route.ts verbatim -- see that file's header comment
// for why this route adds no server-side admin check of its own (Postgres
// is what actually decides admin-or-not; the sign-in check below is
// defense-in-depth) and for the demo-mode-404 rationale, both identical
// here. A non-admin's request resolves to a curated "Not found." (404), not
// a raw 403 -- see `renameTeamMember`/`deleteTeamMember`'s own doc comments
// (lib/server/reports-service.ts) for why that's not distinguished from a
// genuinely unknown id (same posture as `renameProject`/`deleteProject`).

import { NextResponse, type NextRequest } from 'next/server';
import { TeamMemberRenameInputSchema } from '@/lib/schema/api';
import { deleteTeamMember, renameTeamMember } from '@/lib/server/reports-service';
import { assertBodySize, assertMutationAllowed, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
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

  const parsed = TeamMemberRenameInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  try {
    const member = await renameTeamMember(supabase, id, parsed.data.name);
    return NextResponse.json({ member });
  } catch (err) {
    return handleServiceError(err, { route: 'api/team/[id] PATCH', userId: user.id });
  }
}

// DELETE takes no request body -- only the Sec-Fetch-Site half of
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
    await deleteTeamMember(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleServiceError(err, { route: 'api/team/[id] DELETE', userId: user.id });
  }
}
