// Phase 7b (M3): a bare, cookie-less Supabase client running as the `anon`
// role -- used ONLY to resolve a report via its public share token
// (`get_shared_report`, via lib/server/reports-service.ts's
// `getSharedReport`). Deliberately NOT `createServerSupabase()`
// (lib/supabase/server.ts, which binds the request's session cookies): see
// CLAUDE.md's "carried trap #2" -- a signed-in visitor's own session must
// NEVER be able to satisfy a wrong or missing token, and the only way to
// make that structural rather than behavioral is to hand `getSharedReport` a
// client that has no session to fall back to in the first place. No
// service-role key is used anywhere in this file, or anywhere in Phase 7b --
// `get_shared_report` is a SECURITY DEFINER RPC granted to `anon`
// specifically so a plain anon-key client is enough (supabase/migrations/
// 20260719000004_auth_ownership.sql).
//
// A fresh client per call (not a module-scope singleton, unlike
// lib/supabase/client.ts's browser singleton): this only ever runs
// server-side, once per present-route request -- there is no persistent
// browser tab to amortize a singleton across, and a singleton here would
// invite a future author to reach for it from somewhere it doesn't belong.

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'getSupabaseAnonClient() called without NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY set -- callers must check isSupabaseConfigured() first.'
    );
  }
  // Post-review nit: `persistSession`/`autoRefreshToken` are both already
  // no-ops here in practice (no session is ever established on this client
  // -- it never authenticates, only calls one anon-granted RPC), but setting
  // them `false` explicitly is the conventional shape for a throwaway,
  // per-request server-side client and makes the cookie-less/stateless
  // property visible at the call site, not just in this file's header
  // comment.
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
