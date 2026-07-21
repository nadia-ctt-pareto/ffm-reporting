// Phase 8a: DELETE (revoke) for `/api/tokens/[id]` -- calls the SECURITY
// DEFINER `revoke_api_token` RPC (supabase/migrations/
// 20260721000007_mcp_tokens.sql) via the cookie-bound client, since
// `api_tokens` has no UPDATE policy of its own (by design -- see that
// migration and the 7a migration's "tokens are create/revoke only"
// comment). Sets `revoked_at`, never a DELETE -- preserves the audit
// trail. See app/api/tokens/route.ts's header comment for the
// `isSupabaseConfigured()` gating rationale -- identical here.

import { NextResponse, type NextRequest } from 'next/server';
import { curatedMessage, logServiceError, ServiceError } from '@/lib/server/reports-service';
import { assertMutationAllowed } from '@/lib/server/request-guards';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE takes no request body -- only the Sec-Fetch-Site half of
// assertMutationAllowed applies (requireJsonBody defaults false), same as
// app/api/reports/[id]/share/route.ts's POST/DELETE.
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
  const { error } = await supabase.rpc('revoke_api_token', { p_token_id: id });
  if (error) {
    const sqlstate = (error as { code?: string }).code ?? '';
    const message = error.message ?? 'Unexpected database error.';
    // `revoke_api_token` raises 42501 for both "not found" and "not yours"
    // -- deliberately not distinguished, mirroring the SQL function's own
    // comment (the two cases getting the same curated forbidden message is
    // the point, not an oversight).
    const isForbidden = sqlstate === '42501' || /not found or not permitted|permission denied/i.test(message);
    const serviceErr = new ServiceError(isForbidden ? 'forbidden' : 'internal', message);
    logServiceError(serviceErr, { route: 'api/tokens/[id] DELETE', userId: user.id, reportId: id });
    return NextResponse.json({ error: curatedMessage(serviceErr.code, serviceErr.message) }, { status: isForbidden ? 403 : 500 });
  }
  return new NextResponse(null, { status: 204 });
}
