// WP3 (the access flip): PATCH for `/api/tasks/[id]` -- the narrow,
// owner-OR-assignee task patch (status/deadline/completedAt ONLY). Cloned
// from `app/api/reports/[id]/route.ts`'s PATCH skeleton -- see that file's
// header comment for the demo-mode-404 and defense-in-depth-auth-check
// rationale, identical here. Access itself is decided entirely by
// `update_assigned_task` (lib/server/reports-service.ts's
// `updateAssignedTask`, supabase/migrations/20260726000018_scoped_access.sql)
// -- this route adds no owner/assignee check of its own.

import { NextResponse, type NextRequest } from 'next/server';
import { AssignedTaskPatchSchema } from '@/lib/schema/api';
import { updateAssignedTask } from '@/lib/server/reports-service';
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

  const parsed = AssignedTaskPatchSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  try {
    const task = await updateAssignedTask(supabase, id, parsed.data);
    return NextResponse.json({ task });
  } catch (err) {
    return handleServiceError(err, { route: 'api/tasks/[id] PATCH', userId: user.id, reportId: id });
  }
}
