// Phase 7c (BYOK AI field polish): CRUD over `ai_keys`, following the
// Phase 7b service contract (CLAUDE.md's "Data plane") exactly -- every
// exported function takes the Supabase client it must run AS (the
// cookie-bound client from `createServerSupabase()`), this module NEVER
// constructs a client itself, and it MUST NEVER be handed a service-role
// client. `ai_keys` RLS (supabase/migrations/20260722000008_ai_keys.sql) is
// what enforces "a user can only ever touch their own row" -- deliberately
// with NO `is_admin()` branch on any verb, tighter than every other table in
// this schema (an admin manages reports; an admin must never read another
// user's Anthropic key).
//
// `getAiKeyPlaintext` is the one function in this whole feature that ever
// holds a decrypted key -- it returns that plaintext to its caller
// (`lib/server/ai-polish.ts`'s `polishField`), which uses it for exactly one
// outbound fetch and never assigns it anywhere else. Every OTHER function
// here only ever touches ciphertext or non-secret metadata.

import type { SupabaseClient } from '@supabase/supabase-js';
import { AiCryptoError, decryptSecret, encryptSecret } from './ai-crypto';
import { validateAnthropicKey } from './ai-polish';
import { ServiceError } from './reports-service';

export interface AiKeyStatus {
  configured: boolean;
  hint: string;
  validatedAt: string | null;
  lastUsedAt: string | null;
}

interface AiKeyStatusRow {
  key_hint: string;
  validated_at: string | null;
  last_used_at: string | null;
}

/**
 * `GET /api/ai/key`'s data source. No `.eq('user_id', ...)` filter needed --
 * `ai_keys_select` RLS (`user_id = auth.uid()`) already narrows this to at
 * most the caller's own single row (same pattern `app/api/tokens/route.ts`'s
 * GET already uses for `api_tokens`). Returns `configured: false` (never
 * throws) when the caller has no row yet -- "no key saved" is an ordinary
 * state, not an error.
 */
export async function getAiKeyStatus(db: SupabaseClient): Promise<AiKeyStatus> {
  const { data, error } = await db.from('ai_keys').select('key_hint, validated_at, last_used_at').maybeSingle();
  if (error) {
    console.error('[ai-keys] getAiKeyStatus query error', { code: error.code });
    throw new ServiceError('internal', 'Failed to load the AI key status.');
  }
  if (!data) return { configured: false, hint: '', validatedAt: null, lastUsedAt: null };
  const row = data as AiKeyStatusRow;
  return { configured: true, hint: row.key_hint, validatedAt: row.validated_at, lastUsedAt: row.last_used_at };
}

/** A short, display-only fingerprint -- e.g. `sk-ant-...ab12` -- never the key itself. Falls back to a generic mask if the key is shorter than expected (still never empty). */
function fingerprint(apiKey: string): string {
  const tail = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey;
  const head = apiKey.length >= 8 ? apiKey.slice(0, 7) : apiKey.slice(0, Math.max(0, apiKey.length - 4));
  return `${head}...${tail}`;
}

/**
 * Validates `plaintextKey` against Anthropic FIRST (`validateAnthropicKey`,
 * lib/server/ai-polish.ts -- a 1-token ping to `POLISH_MODEL`) -- an invalid
 * key is never encrypted or stored. Only on success: encrypt, then call
 * `set_own_ai_key()` (supabase/migrations/20260722000008_ai_keys.sql) --
 * NOT a plain client-side `.upsert()`. That migration's header comment has
 * the full "VERIFIED GOTCHA": `ON CONFLICT ... DO UPDATE SET key_ciphertext
 * = excluded.key_ciphertext` requires SELECT privilege on `key_ciphertext`
 * to reference `excluded`, which `authenticated` deliberately never has --
 * a direct client-side upsert cannot satisfy both "authenticated can write
 * it" and "authenticated can never read it" at once, so the write goes
 * through a SECURITY DEFINER function instead, same as the read side
 * (`getAiKeyPlaintext` below). The RPC stamps `validated_at`/`updated_at`
 * itself (server `now()`, never a client-supplied timestamp) and returns
 * the `validated_at` it actually wrote.
 */
export async function setAiKey(db: SupabaseClient, plaintextKey: string): Promise<{ hint: string; validatedAt: string }> {
  const trimmed = plaintextKey.trim();
  await validateAnthropicKey(trimmed);

  const hint = fingerprint(trimmed);
  let ciphertext: string;
  try {
    ciphertext = encryptSecret(trimmed);
  } catch (err) {
    // SHOULD-FIX 3 (post-review): `encryptSecret` throws `AiCryptoError` for
    // a missing/malformed `AI_BYOK_ENCRYPTION_KEY` -- e.g. present (so
    // `isAiPolishConfigured()` passed) but not 32 base64 bytes. Left
    // uncaught, that's an un-normalized error `handleServiceError` treats
    // as a genuinely unexpected throw -> a generic 500, giving an operator
    // no signal at all about what's actually wrong. Re-thrown here as the
    // SAME `ai_key_unreadable` marker/curated message the decrypt-failure
    // path already uses (lib/server/reports-service.ts's `curatedMessage`)
    // -- reusing the closest existing curated message rather than adding a
    // new marker for what is, in both cases, "the encryption key situation
    // needs attention before a key can be used here." `AiCryptoError`'s own
    // `.message` is safe to log (see lib/server/ai-crypto.ts's header
    // comment -- it never embeds the plaintext/ciphertext), but is NOT
    // reused as the `ServiceError` message below (that would bypass the
    // marker-token match in `curatedMessage` and fall through to the
    // generic 'invalid' string) -- logged separately instead.
    if (err instanceof AiCryptoError) {
      console.error('[ai-keys] setAiKey: encryptSecret failed', { message: err.message });
      throw new ServiceError('invalid', 'ai_key_unreadable: could not encrypt the key for storage (check AI_BYOK_ENCRYPTION_KEY).');
    }
    throw err;
  }

  const { data, error } = await db.rpc('set_own_ai_key', { p_key_ciphertext: ciphertext, p_key_hint: hint });
  if (error) {
    // Deliberate: logs the Postgres error code/message, NEVER `ciphertext`,
    // `hint`, or `trimmed` -- see this file's header comment and
    // lib/server/ai-crypto.ts's header comment for the "never in logs"
    // invariant this whole feature is built around.
    console.error('[ai-keys] setAiKey RPC error', { code: error.code });
    throw new ServiceError('internal', 'Failed to store the AI key.');
  }
  return { hint, validatedAt: data as string };
}

/**
 * Removes the caller's own key (if any). Fetches the caller's own id via
 * `db.auth.getUser()` (this IS the cookie-bound, session-aware client --
 * see this file's header comment) purely to give the `DELETE` an explicit,
 * defensive `.eq('user_id', ...)` filter; `ai_keys_delete` RLS
 * (`user_id = auth.uid()`) is what actually enforces this regardless, so a
 * missing/unresolvable session here just means there is nothing this caller
 * could have deleted anyway.
 */
export async function deleteAiKey(db: SupabaseClient): Promise<void> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    throw new ServiceError('unauthorized', 'deleteAiKey called without a resolvable session.');
  }
  const { error } = await db.from('ai_keys').delete().eq('user_id', user.id);
  if (error) {
    console.error('[ai-keys] deleteAiKey error', { code: error.code });
    throw new ServiceError('internal', 'Failed to remove the AI key.');
  }
}

/**
 * The ONLY path that ever reconstructs a usable plaintext key -- mirrors
 * `lib/server/mcp-auth.ts`'s secret-read shape: one `db.rpc(...)` call
 * (here, via the COOKIE-BOUND client -- there IS a real session in this
 * flow, unlike the MCP bridge's bare anon client), then decrypt in Node
 * (`lib/server/ai-crypto.ts`). `get_own_ai_key_ciphertext()`
 * (supabase/migrations/20260722000008_ai_keys.sql) is `auth.uid()`-scoped
 * and stamps `last_used_at` atomically as part of the same round trip.
 *
 * Returns `null` on ANY failure -- no row, an RPC error, or a decrypt
 * failure (wrong `AI_BYOK_ENCRYPTION_KEY`, e.g. after rotation, or corrupt
 * ciphertext) -- collapsing "no key" and "key unreadable" into the same
 * signal on purpose: `lib/server/ai-polish.ts`'s `polishField` maps either
 * case to the identical `ai_key_unreadable` remedy ("add/re-enter your key
 * in Settings"). Every `console.error` below logs a Postgres error code or
 * a fixed diagnostic string ONLY -- never the ciphertext, never the
 * plaintext, never a raw underlying crypto error message.
 */
export async function getAiKeyPlaintext(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.rpc('get_own_ai_key_ciphertext');
  if (error) {
    console.error('[ai-keys] get_own_ai_key_ciphertext RPC error', { code: error.code });
    return null;
  }
  const ciphertext = data as string | null;
  if (!ciphertext) return null;
  try {
    return decryptSecret(ciphertext);
  } catch {
    console.error('[ai-keys] getAiKeyPlaintext: stored key exists but could not be decrypted (see lib/server/ai-crypto.ts).');
    return null;
  }
}
