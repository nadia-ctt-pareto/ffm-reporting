// WP1: GET (list) / POST (ensure-exists) for `/api/team`. Cloned from
// app/api/projects/route.ts's 5-step shape verbatim (demo-mode 404 ->
// assertMutationAllowed -> auth -> validate -> service -> handleServiceError)
// -- see that file's header comment for the demo-mode-404 and
// defense-in-depth-auth-check rationale, identical here. POST is
// insert-or-return-existing, never a rename -- see
// lib/server/reports-service.ts's `ensureTeamMember` doc comment.
//
// Unlike `/api/projects`, POST here is admin-gated at the RLS layer
// (`team_members_insert`, supabase/migrations/20260726000016_team_members.sql)
// -- this route adds no server-side admin check of its own (same posture as
// app/api/projects/[id]/route.ts's PATCH/DELETE): the sign-in check below is
// defense-in-depth, Postgres is what actually decides admin-or-not. A
// non-admin's POST insert is rejected by RLS with sqlstate 42501, which
// `mapPgError` (lib/server/reports-service.ts) maps to `'forbidden'` ->
// HTTP 403, curated by `curatedMessage` to "You don't have permission to do
// that." -- never a raw Postgres message, and never a silent success.

import { NextResponse, type NextRequest } from 'next/server';
import { TeamMemberInputSchema } from '@/lib/schema/api';
import { ensureTeamMember, listTeamMembers } from '@/lib/server/reports-service';
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
    const members = await listTeamMembers(supabase);
    return NextResponse.json({ members });
  } catch (err) {
    return handleServiceError(err, { route: 'api/team GET', userId: user.id });
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

  const parsed = TeamMemberInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const member = await ensureTeamMember(supabase, parsed.data);
    return NextResponse.json({ member });
  } catch (err) {
    return handleServiceError(err, { route: 'api/team POST', userId: user.id });
  }
}
