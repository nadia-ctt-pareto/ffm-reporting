// Phase 7b (M1): POST (enable) / DELETE (revoke) a report's public share
// token. Post-review (BLOCKER 1) added GET -- an owner-or-admin-gated read
// of the CURRENT token (or `null` if sharing isn't enabled), backed by the
// new `get_report_share_token` SECURITY DEFINER RPC (supabase/migrations/
// 20260720000005_post_review_hardening.sql). This is the ONLY read path
// for `share_token` left anywhere in the app now that `authenticated`'s
// column-level SELECT grant on `reports` excludes it -- `GET /api/reports`/
// `GET /api/reports/[id]` can never see it again (see
// lib/server/reports-service.ts's `reportsQuery`). Designed for Milestone
// M3's ShareDialog: it needs the current token for exactly ONE report at a
// time (to decide "Enable public link" vs. "Copy / Revoke") without
// re-minting one on every render the way POST would.
//
// See app/api/reports/route.ts's header comment for the demo-mode-404 and
// defense-in-depth-auth-check rationale -- identical here. All three verbs
// are owner-or-admin-gated INSIDE Postgres (SECURITY DEFINER, see the
// migration above) -- a non-owner, non-admin caller gets a 42501 from the
// RPC itself, mapped to 403 here.

import { NextResponse, type NextRequest } from 'next/server';
import { enableShare, getShareToken, revokeShare } from '@/lib/server/reports-service';
import { assertMutationAllowed } from '@/lib/server/request-guards';
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
    const shareToken = await getShareToken(supabase, id);
    return NextResponse.json({ shareToken });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id]/share GET', userId: user.id, reportId: id });
  }
}

// POST/DELETE below take no request body at all -- only the Sec-Fetch-Site
// half of assertMutationAllowed applies (requireJsonBody defaults false).
export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const token = await enableShare(supabase, id);
    return NextResponse.json({ token });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id]/share POST', userId: user.id, reportId: id });
  }
}

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
    await revokeShare(supabase, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleServiceError(err, { route: 'api/reports/[id]/share DELETE', userId: user.id, reportId: id });
  }
}
