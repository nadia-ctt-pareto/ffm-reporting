// Phase 7c (BYOK AI field polish): application-level AES-256-GCM, Node
// `crypto`, no new dependency -- see CLAUDE.md's Phase 7c section for the
// full threat model this implements (and the honest limits of it: a
// compromised app server can always decrypt, by construction, since it must
// be able to decrypt to proxy a call to Anthropic at all).
//
// Encryption key: `AI_BYOK_ENCRYPTION_KEY`, a server-only env var (32 raw
// bytes, base64-encoded -- generate with `openssl rand -base64 32`; see
// .env.example). Deliberately NEVER `NEXT_PUBLIC_*` -- it must never reach
// the client bundle. Stored payload shape: `base64(iv (12 bytes) || authTag
// (16 bytes) || ciphertext)` in one column (`ai_keys.key_ciphertext`).
//
// EVERY thrown error here is deliberately message-only-and-generic --
// mapped to the `ai_key_unreadable` marker token (see
// `lib/server/reports-service.ts`'s `curatedMessage`) -- and NEVER embeds
// the plaintext, the ciphertext, or a raw Node crypto error message (some
// Node versions' `OperationalError` for a bad auth tag can, in principle,
// include buffer-derived detail). Losing/rotating `AI_BYOK_ENCRYPTION_KEY`
// makes every previously-stored key permanently undecryptable -- that's
// this module's job to degrade gracefully into "re-enter your key in
// Settings", never a raw 500 or a crash. See docs/database-schema.md's
// "ai_keys (BYOK)" section for the full operational note.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isSupabaseConfigured } from '../supabase/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // bytes, GCM's recommended nonce size
const AUTH_TAG_LENGTH = 16; // bytes, GCM's standard tag size
const KEY_LENGTH = 32; // bytes -- AES-256

/**
 * Thrown by `encryptSecret`/`decryptSecret` for ANY failure -- missing/
 * malformed `AI_BYOK_ENCRYPTION_KEY`, malformed stored ciphertext, or a
 * failed GCM auth-tag verification (wrong key -- e.g. after rotation -- or
 * tampered ciphertext). Callers (`lib/server/ai-keys.ts`) catch this and
 * degrade to the `ai_key_unreadable` `ServiceError` marker, never a raw
 * 500. `.message` is always a fixed, safe-to-log diagnostic string -- never
 * derived from the plaintext/ciphertext/raw crypto error.
 */
export class AiCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiCryptoError';
  }
}

function loadEncryptionKey(): Buffer {
  const raw = process.env.AI_BYOK_ENCRYPTION_KEY;
  if (!raw) {
    throw new AiCryptoError('ai_key_unreadable: AI_BYOK_ENCRYPTION_KEY is not set.');
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new AiCryptoError('ai_key_unreadable: AI_BYOK_ENCRYPTION_KEY is not valid base64.');
  }
  if (key.length !== KEY_LENGTH) {
    throw new AiCryptoError(`ai_key_unreadable: AI_BYOK_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}).`);
  }
  return key;
}

/** Encrypts `plaintext` (the raw Anthropic API key) under `AI_BYOK_ENCRYPTION_KEY`, returning `base64(iv || authTag || ciphertext)`. A fresh random IV every call -- GCM's security depends on never reusing a (key, IV) pair. */
export function encryptSecret(plaintext: string): string {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Inverse of `encryptSecret`. Throws `AiCryptoError` (never returns a garbage string) on any failure -- malformed payload, or GCM auth-tag verification failure (wrong `AI_BYOK_ENCRYPTION_KEY` -- e.g. after rotation -- or tampered ciphertext). */
export function decryptSecret(payload: string): string {
  const key = loadEncryptionKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(payload, 'base64');
  } catch {
    throw new AiCryptoError('ai_key_unreadable: stored ciphertext is not valid base64.');
  }
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new AiCryptoError('ai_key_unreadable: stored ciphertext is malformed (too short to contain an iv + auth tag).');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Deliberately swallows the underlying Node crypto error -- never
    // forwarded (see this file's header comment on why).
    throw new AiCryptoError('ai_key_unreadable: decryption failed (wrong AI_BYOK_ENCRYPTION_KEY, or corrupted ciphertext).');
  }
}

/**
 * Mirrors `lib/server/mcp-auth.ts`'s `isMcpConfigured()` shape exactly:
 * Supabase configured (so there is a Postgres row + per-user auth to scope
 * a key to) AND the encryption key present (so a stored key could ever be
 * decrypted again). Missing `AI_BYOK_ENCRYPTION_KEY` alone (with Supabase
 * otherwise configured) is a distinct, non-fatal misconfiguration -- see
 * `app/api/ai/key/route.ts` / `app/api/ai/polish/route.ts` (404 when this
 * is false) and `components/settings/AiKeySection.tsx` (a muted note
 * instead of the key-entry form).
 */
export function isAiPolishConfigured(): boolean {
  return isSupabaseConfigured() && Boolean(process.env.AI_BYOK_ENCRYPTION_KEY);
}
