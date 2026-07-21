-- Weekly Reports Dashboard -- BYOK generalization delta: any provider, not
-- just Anthropic. Extends `ai_keys` (Phase 7c,
-- supabase/migrations/20260722000008_ai_keys.sql) with three NON-SECRET
-- metadata columns -- `provider`, `base_url`, `model` -- so the polish
-- feature can proxy to either the native Anthropic Messages API OR any
-- OpenAI Chat-Completions-compatible endpoint (OpenRouter, OpenAI, Groq,
-- Together, DeepSeek, Mistral, ...) under the SAME encrypted-key storage
-- and owner-only RLS. `key_ciphertext` itself is COMPLETELY UNCHANGED --
-- still opaque to every SQL role, still only ever touched by
-- set_own_ai_key()/get_own_ai_key_ciphertext() below. Read this alongside
-- lib/server/ai-keys.ts (setAiKey now accepts provider/baseUrl/model) and
-- lib/server/ai-polish.ts (two request/response builders, one per
-- provider) -- together they are the entire generalized BYOK surface. See
-- CLAUDE.md's "BYOK AI field polish (Phase 7c)" section and
-- docs/database-schema.md's "ai_keys (BYOK)" section for the full picture.
--
-- SSRF note: `base_url` is USER-CONTROLLED for provider='openai_compatible'
-- and the server makes an outbound fetch to it -- this migration only
-- stores the value; the actual SSRF hardening (https-only, private/
-- reserved-range rejection, DNS-rebinding-aware resolution, no-redirect
-- fetch) lives entirely in lib/server/ssrf.ts's `assertSafeOutboundUrl`,
-- applied BOTH at save-time (lib/server/ai-polish.ts's
-- validateOpenAiCompatibleKey) AND at every polish call (callOpenAiCompatible,
-- same file) -- SQL cannot enforce network-level reachability/host-safety,
-- only shape/presence.

alter table public.ai_keys
  add column provider text not null default 'anthropic',
  add column base_url text,
  add column model text;

alter table public.ai_keys
  add constraint ai_keys_provider_check check (provider in ('anthropic', 'openai_compatible'));

-- 'openai_compatible' has no sane built-in default the way 'anthropic' does
-- (a fixed https://api.anthropic.com base + a documented POLISH_MODEL
-- fallback, lib/server/ai-polish.ts) -- the user MUST supply both a
-- base_url and a model for it to mean anything at request-build time
-- (lib/server/ai-polish.ts's callOpenAiCompatible reads both
-- unconditionally, no fallback). 'anthropic' allows both NULL -- the app
-- supplies its own fixed base and a default model.
alter table public.ai_keys
  add constraint ai_keys_openai_compatible_requires_fields check (
    provider <> 'openai_compatible' or (base_url is not null and model is not null)
  );

-- Same length-cap discipline as supabase/migrations/20260720000006_post_review_hardening_round2.sql
-- (every free-text column in this schema gets an explicit CHECK bound, not
-- just app-layer trust) -- mirrored by lib/schema/api.ts's SetAiKeyInputSchema
-- (.max(500)/.max(200)) so a request this large is rejected before it ever
-- reaches Postgres.
alter table public.ai_keys
  add constraint ai_keys_base_url_len check (base_url is null or char_length(base_url) <= 500);
alter table public.ai_keys
  add constraint ai_keys_model_len check (model is null or char_length(model) <= 200);

comment on column public.ai_keys.provider is
  'BYOK generalization. ''anthropic'' (native Messages API) or ''openai_compatible'' (OpenAI Chat Completions request/response shape -- OpenRouter, OpenAI, Groq, Together, DeepSeek, Mistral, ...). Non-secret. Defaults to ''anthropic'' for every pre-existing row (Phase 7c''s original, single-provider rows).';
comment on column public.ai_keys.base_url is
  'BYOK generalization. Non-secret. NULL for provider=''anthropic'' (fixed https://api.anthropic.com, never user-controlled -- lib/server/ai-polish.ts''s ANTHROPIC_BASE_URL). Required for provider=''openai_compatible'' (enforced by ai_keys_openai_compatible_requires_fields above) -- e.g. https://openrouter.ai/api/v1. SSRF-validated server-side on every save AND every polish call (lib/server/ssrf.ts''s assertSafeOutboundUrl) -- this column stores whatever passed that check; the check itself is not re-derivable from SQL alone.';
comment on column public.ai_keys.model is
  'BYOK generalization. Non-secret. NULL for provider=''anthropic'' (lib/server/ai-polish.ts''s POLISH_MODEL, ''claude-sonnet-5'', is used as the default) or an explicit override. Required for provider=''openai_compatible'' (enforced by ai_keys_openai_compatible_requires_fields above) -- e.g. anthropic/claude-sonnet-5 (an OpenRouter model id).';

-- Same "widen the column-restricted SELECT grant" pattern as
-- supabase/migrations/20260724000010_oauth.sql's api_tokens delta
-- (revoke, then re-grant the FULL widened column list): these three
-- columns are NON-SECRET metadata (unlike key_ciphertext, which stays
-- excluded below, unchanged) -- getAiKeyStatus (lib/server/ai-keys.ts)
-- needs to read them WITHOUT the ciphertext for GET /api/ai/key, and the
-- polish path (getAiKeyProviderConfig, same file) needs provider/base_url/
-- model to decide which provider's request builder to use, likewise
-- WITHOUT ever touching key_ciphertext (that stays
-- get_own_ai_key_ciphertext()-only, unchanged from Phase 7c).
revoke select on public.ai_keys from authenticated;
grant select (user_id, key_hint, created_at, updated_at, validated_at, last_used_at, provider, base_url, model) on public.ai_keys to authenticated;

-- =============================================================================
-- set_own_ai_key: extended to accept + set provider/base_url/model.
-- =============================================================================
-- Mirrors the ORIGINAL Phase 7c function's EXACT posture (SECURITY
-- DEFINER, `set search_path = ''`, schema-qualified names, `revoke all ...
-- from public, anon, authenticated` THEN a narrow explicit `grant`) -- see
-- 20260722000008_ai_keys.sql's header comment for why each of those is
-- load-bearing; none of that changes here. Adding parameters to an
-- existing function is a NEW, DISTINCT overload in Postgres (a different
-- argument count) -- `create or replace` alone would leave the OLD 2-arg
-- `set_own_ai_key(text, text)` callable ALONGSIDE this one (two functions,
-- same name, different signatures), so the old signature is explicitly
-- dropped first -- verified this is safe: nothing else in this schema
-- references the 2-arg overload by name/signature (only by the bare
-- function name, which `db.rpc('set_own_ai_key', {...})` in
-- lib/server/ai-keys.ts resolves via PostgREST's own arg-matching against
-- the JSON keys sent, not a fixed signature callers hardcode).
drop function if exists public.set_own_ai_key(text, text);

create or replace function public.set_own_ai_key(
  p_key_ciphertext text,
  p_key_hint text,
  p_provider text default 'anthropic',
  p_base_url text default null,
  p_model text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.ai_keys (user_id, key_ciphertext, key_hint, provider, base_url, model, validated_at, updated_at)
  values ((select auth.uid()), p_key_ciphertext, p_key_hint, p_provider, p_base_url, p_model, v_now, v_now)
  on conflict (user_id) do update
  set key_ciphertext = excluded.key_ciphertext,
      key_hint = excluded.key_hint,
      provider = excluded.provider,
      base_url = excluded.base_url,
      model = excluded.model,
      validated_at = excluded.validated_at,
      updated_at = excluded.updated_at;

  return v_now;
end;
$$;

comment on function public.set_own_ai_key(text, text, text, text, text) is
  'BYOK generalization delta of the Phase 7c function of the same name -- see 20260722000008_ai_keys.sql for the original''s full comment (unchanged posture: SECURITY DEFINER, auth.uid()-scoped, no id argument, the ONLY write path for key_ciphertext). Now also sets provider/base_url/model (shape-validated by this table''s own CHECK constraints above, and by lib/schema/api.ts''s SetAiKeyInputSchema BEFORE this RPC is ever called). Called by lib/server/ai-keys.ts''s setAiKey, AFTER the provider-appropriate validation call (validateAnthropicKey or validateOpenAiCompatibleKey, lib/server/ai-polish.ts) has already confirmed the key (and, for openai_compatible, the base_url + model) against the real provider -- an invalid key/endpoint never reaches this function at all.';

revoke all on function public.set_own_ai_key(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_own_ai_key(text, text, text, text, text) to authenticated;

-- get_own_ai_key_ciphertext() is UNCHANGED -- see 20260722000008_ai_keys.sql.
-- It only ever reads/returns key_ciphertext, which this migration does not
-- touch; the polish path reads provider/base_url/model separately, via the
-- plain column-grant select above (lib/server/ai-keys.ts's
-- getAiKeyProviderConfig), not through this DEFINER function.
