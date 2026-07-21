// Phase 8c: PATCH (rename) + DELETE for `/api/projects/[id]`. Both are
// admin-only at the RLS layer (`projects_update`/`projects_delete`,
// UNCHANGED by this phase -- see supabase/migrations/
// 20260719000004_auth_ownership.sql -- and the column-level UPDATE grant
// added in supabase/migrations/20260724000011_project_management.sql).
// This route adds no server-side admin check of its own: the sign-in check
// below is defense-in-depth (any signed-in user reaches the service
// function; Postgres is what actually decides admin-or-not) -- see
// CLAUDE.md's "LOCKED DECISION: rename/delete = ADMINS ONLY". A non-admin's
// request still resolves to a curated "Not found." (404), not a raw 403 --
// see `renameProject`/`deleteProject`'s own doc comments (lib/server/
// reports-service.ts) for why that's not distinguished from a genuinely
// unknown id. See app/api/reports/[id]/route.ts's header comment for the
// demo-mode-404 rationale -- identical here.

import { NextResponse, type NextRequest } from 'next/server';
import { ProjectRenameInputSchema } from '@/lib/schema/api';
import { deleteProject, renameProject } from '@/lib/server/reports-service';
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

  const parsed = ProjectRenameInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  try {
    const project = await renameProject(supabase, id, parsed.data.name);
    return NextResponse.json({ project });
  } catch (err) {
    return handleServiceError(err, { route: 'api/projects/[id] PATCH', userId: user.id });
  }
}

// DELETE takes no request body -- only the Sec-Fetch-Site half of
// assertMutationAllowed applies (requireJsonBody defaults false), same as
// app/api/tokens/[id]/route.ts's DELETE.
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
    await deleteProject(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleServiceError(err, { route: 'api/projects/[id] DELETE', userId: user.id });
  }
}
