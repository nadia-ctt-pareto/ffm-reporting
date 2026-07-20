// Phase 7b (M1): GET (list) / POST (ensure-exists) for `/api/projects`. See
// app/api/reports/route.ts's header comment for the demo-mode-404 and
// defense-in-depth-auth-check rationale -- identical here. POST is
// insert-or-return-existing, never a rename -- see
// lib/server/reports-service.ts's `ensureProject` doc comment.

import { NextResponse, type NextRequest } from 'next/server';
import { ProjectInputSchema } from '@/lib/schema/api';
import { ensureProject, listProjects } from '@/lib/server/reports-service';
import { assertBodySize, assertMutationAllowed, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { handleServiceError } from '@/lib/server/route-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const projects = await listProjects(supabase);
    return NextResponse.json({ projects });
  } catch (err) {
    return handleServiceError(err, { route: 'api/projects GET', userId: user.id });
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

  const parsed = ProjectInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const project = await ensureProject(supabase, parsed.data);
    return NextResponse.json({ project });
  } catch (err) {
    return handleServiceError(err, { route: 'api/projects POST', userId: user.id });
  }
}
