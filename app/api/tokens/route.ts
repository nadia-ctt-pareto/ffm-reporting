// Phase 8a: GET (list the caller's own MCP API tokens, non-secret columns
// only) / POST (mint a new token) for `/api/tokens`. Follows
// app/api/reports/route.ts's guard/error skeleton exactly (demo-mode 404,
// defense-in-depth `auth.getUser()` check, CSRF/body-size guards ahead of
// the mutating verb).
//
// Gated on `isSupabaseConfigured()` (NOT `isMcpConfigured()`): token
// management is a Supabase-Auth-scoped CRUD feature, independent of
// whether `SUPABASE_JWT_SECRET` happens to be set -- a token created here
// while that secret is missing just can't be BRIDGED into a working MCP
// session yet (see `app/api/[transport]/route.ts`, gated on
// `isMcpConfigured()`), which is a distinct, non-fatal misconfiguration.
// GET's response carries `endpointReady: isMcpConfigured()` so
// `McpAccessSection` can surface that exact "configured but not
// bridge-ready yet" state instead of letting an operator mint a token that
// silently 404s on every call.
//
// POST is the ONLY place a token's plaintext value ever exists outside the
// caller's own clipboard -- `lib/server/mcp-auth.ts`'s
// `hashApiTokenForStorage` computes the sha-256 hex this row actually
// stores (`token_hash`); Postgres never sees (or needs to see) the
// plaintext again, and GET below never selects that column. Insert goes
// through the COOKIE-BOUND client (`createServerSupabase()`), under
// `api_tokens`'s existing RLS (`api_tokens_insert`: `user_id = auth.uid()`,
// supabase/migrations/20260719000004_auth_ownership.sql) -- never a
// service-role client, matching the "no service-role key anywhere"
// invariant this whole phase is built around.

import { randomBytes, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { hashApiTokenForStorage, isMcpConfigured } from '@/lib/server/mcp-auth';
import { curatedMessage, logServiceError, ServiceError, type ServiceErrorCode } from '@/lib/server/reports-service';
import { assertBodySize, assertMutationAllowed, MAX_BODY_BYTES, readJsonBody } from '@/lib/server/request-guards';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

const TOKEN_ID_PREFIX = 'tok';
const TOKEN_VALUE_PREFIX = 'ffmcp_';

/** Request body for POST -- a human label only ("Claude Desktop", "laptop"); everything else (id, token_hash) is server-generated, never client-supplied. */
const CreateApiTokenRequestSchema = z.object({
  label: z.string().max(200).optional().default(''),
});

interface ApiTokenSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * `api_tokens` isn't part of `lib/server/reports-service.ts`'s domain, and
 * this phase's scope deliberately does not modify that file -- so this is a
 * small, local mirror of its private `mapPgError`'s code-branching logic
 * (branch on Postgres `code` first, per PostgrestError's own doc-comment
 * recommendation), kept here rather than exported from that file to avoid
 * widening its surface for a table it doesn't own.
 */
function mapTokenPgError(error: { code?: string; message?: string } | null | undefined): ServiceError {
  const sqlstate = error?.code ?? '';
  const message = error?.message ?? 'Unexpected database error.';
  let code: ServiceErrorCode;
  if (sqlstate === '42501' || /row-level security|permission denied/i.test(message)) {
    code = 'forbidden';
  } else if (sqlstate === '23505') {
    code = 'conflict';
  } else {
    code = 'internal';
  }
  console.error('[api/tokens] Postgres error', { sqlstate, message, mappedCode: code });
  return new ServiceError(code, message);
}

function statusForServiceError(code: ServiceErrorCode): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'conflict':
      return 409;
    case 'invalid':
      return 400;
    default:
      return 500;
  }
}

function toErrorResponse(err: ServiceError, route: string, userId: string): NextResponse {
  logServiceError(err, { route, userId });
  return NextResponse.json({ error: curatedMessage(err.code, err.message) }, { status: statusForServiceError(err.code) });
}

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('api_tokens')
    .select('id, label, created_at, last_used_at, expires_at, revoked_at')
    .order('created_at', { ascending: false });
  if (error) return toErrorResponse(mapTokenPgError(error), 'api/tokens GET', user.id);

  const tokens: ApiTokenSummary[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    label: (row.label as string) ?? '',
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
  }));
  // `endpointReady`: Supabase is already known-configured at this point
  // (the guard above 404s otherwise), so this reduces to "is
  // SUPABASE_JWT_SECRET set" -- surfaced here (rather than left implicit)
  // so `McpAccessSection` can warn an operator who configured Supabase but
  // forgot the JWT secret, instead of letting them mint a token, copy the
  // `claude mcp add` command, and have every call silently 404 with no clue
  // why. See `isMcpConfigured()` (lib/server/mcp-auth.ts) and
  // `app/api/[transport]/route.ts`, which is what actually 404s in that
  // state.
  return NextResponse.json({ tokens, endpointReady: isMcpConfigured() });
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

  const parsed = CreateApiTokenRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid request body.';
    return NextResponse.json({ error: `Invalid request body -- ${detail}`, issues: parsed.error.issues }, { status: 400 });
  }

  // 32 random bytes (256 bits) base64url-encoded -- same entropy as the
  // report share tokens (supabase/migrations/20260719000004_auth_ownership.sql's
  // `enable_report_share`), just base64url instead of hex, and prefixed so
  // a leaked token is secret-scannable (github/gitleaks-style tools key off
  // recognizable prefixes like `ffmcp_`).
  const plaintext = `${TOKEN_VALUE_PREFIX}${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashApiTokenForStorage(plaintext);
  const id = `${TOKEN_ID_PREFIX}_${randomUUID()}`;

  const { data, error } = await supabase
    .from('api_tokens')
    .insert({ id, user_id: user.id, token_hash: tokenHash, label: parsed.data.label })
    .select('id, label, created_at, last_used_at, expires_at, revoked_at')
    .single();
  if (error) return toErrorResponse(mapTokenPgError(error), 'api/tokens POST', user.id);

  const row = data as Record<string, unknown>;
  const token: ApiTokenSummary = {
    id: row.id as string,
    label: (row.label as string) ?? '',
    createdAt: row.created_at as string,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  };
  // `value` (the plaintext) is returned EXACTLY ONCE, here -- never stored
  // anywhere in this app, never re-readable through GET above (which only
  // ever selects the non-secret columns), and unrecoverable if lost (the
  // caller must revoke and create a new one).
  return NextResponse.json({ token, value: plaintext }, { status: 201 });
}
