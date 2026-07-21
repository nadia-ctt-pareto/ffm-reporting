'use client';

// Phase 7c (BYOK AI field polish); generalized to ANY provider (BYOK
// generalization delta): "AI Polish (Bring Your Own Key)" settings section.
// RECONCILIATION DELTA: modeled directly on `McpAccessSection.tsx` -- same
// Supabase-mode gate (SettingsScreen.tsx mounts this only when
// `isSupabaseConfigured()`), same self-contained fetch/CRUD state (no
// shared hook -- `lib/hooks/useAiKeyStatus.ts` exists purely for
// `PolishButton`'s much smaller "is polish available" check, see that
// hook's own doc comment), the same `readApiError` helper shape, and the
// same "secret shown/accepted once, never re-displayed" posture -- except
// here the key is NEVER shown even once (unlike an MCP token's plaintext,
// which IS shown once right after creation): only a masked fingerprint
// (`hint`, e.g. "sk-ant-...ab12") is ever displayed, computed server-side
// from the plaintext at save time, never derived from the ciphertext.
//
// `serverAvailable === false` (a 404 from `GET /api/ai/key`) means Supabase
// IS configured but `AI_BYOK_ENCRYPTION_KEY` is missing -- a distinct,
// non-fatal misconfiguration surfaced as a notice, mirroring
// `McpAccessSection`'s `endpointReady === false` notice for the analogous
// missing-`SUPABASE_JWT_SECRET` case. True demo mode (no Supabase at all)
// never mounts this component at all -- see SettingsScreen.tsx.
//
// BYOK generalization: a provider picker (Anthropic / OpenAI-compatible)
// gates two extra fields (Base URL, Model) that only apply/are required for
// `openai_compatible` -- see lib/schema/api.ts's SetAiKeyInputSchema for the
// server-side mirror of this same "required only for openai_compatible"
// rule. The configured-state display now also shows the provider and model
// alongside the masked key hint.

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { fmtDateShort } from '@/lib/format';
import { invalidateAiKeyStatusCache } from '@/lib/hooks/useAiKeyStatus';
import type { AiProvider } from '@/lib/schema/api';
import styles from './AiKeySection.module.css';

interface AiKeyStatusBody {
  configured: boolean;
  hint: string;
  validatedAt: string | null;
  lastUsedAt: string | null;
  provider: AiProvider;
  baseUrl: string | null;
  model: string | null;
}

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai_compatible', label: 'OpenAI-compatible (OpenRouter, OpenAI, Groq, …)' },
];

function providerLabel(provider: AiProvider): string {
  return provider === 'openai_compatible' ? 'OpenAI-compatible' : 'Anthropic';
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function AiKeySection() {
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<AiKeyStatusBody | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const res = await fetch('/api/ai/key', { credentials: 'same-origin' });
      if (res.status === 404) {
        // AI_BYOK_ENCRYPTION_KEY missing server-side -- see this file's
        // header comment. Not an error to display, a distinct rendered
        // state (the notice below).
        setServerAvailable(false);
        return;
      }
      setServerAvailable(true);
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to load the AI key status.'));
      const body = (await res.json()) as AiKeyStatusBody;
      setStatus(body);
      setLoadError(null);
      if (!body.configured) {
        // First-time setup -- open the form directly, with the defaults a
        // brand-new key should start from.
        setProvider('anthropic');
        setBaseUrlInput('');
        setModelInput('');
        setIsEditing(true);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the AI key status.');
    }
  }

  /** "Replace Key" -- pre-fills provider/baseUrl/model from the EXISTING configuration (so replacing just the key doesn't require retyping an unchanged base URL/model); the key field itself always starts blank -- it's secret, never re-displayed. */
  function handleStartReplace() {
    if (status) {
      setProvider(status.provider);
      setBaseUrlInput(status.baseUrl ?? '');
      setModelInput(status.model ?? '');
    }
    setApiKeyInput('');
    setSaveError(null);
    setIsEditing(true);
  }

  /**
   * COR-2 (post-review): switching providers used to leave `baseUrlInput`/
   * `modelInput` untouched -- e.g. going from `openai_compatible` (model
   * `anthropic/claude-sonnet-5`, an OpenRouter model id) to `anthropic`
   * silently carried that string into Anthropic's OPTIONAL model-override
   * field, so Save would ping a model that doesn't exist there and surface
   * a confusing "Couldn't reach Anthropic" (a network-sounding message for
   * what's actually a bad-model problem). Always reset both fields on a
   * provider change -- simple, predictable, and consistent with the API
   * key field itself already always starting blank on every edit.
   */
  function handleProviderChange(value: string) {
    setProvider(value as AiProvider);
    setBaseUrlInput('');
    setModelInput('');
  }

  const canSave =
    apiKeyInput.trim().length > 0 && (provider !== 'openai_compatible' || (baseUrlInput.trim().length > 0 && modelInput.trim().length > 0));

  async function handleSave() {
    if (!canSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // NIT (post-review): trim before sending -- SetAiKeyInputSchema caps
      // the RAW string at 200 chars and `setAiKey` (lib/server/ai-keys.ts)
      // only trims AFTER validation, so a pasted key with stray leading/
      // trailing whitespace could otherwise land right on (or past) that
      // boundary and 400 for a reason the user can't see.
      const body: { apiKey: string; provider: AiProvider; baseUrl?: string; model?: string } = {
        apiKey: apiKeyInput.trim(),
        provider,
      };
      if (provider === 'openai_compatible') {
        body.baseUrl = baseUrlInput.trim();
        body.model = modelInput.trim();
      } else if (modelInput.trim().length > 0) {
        // Anthropic's model is optional -- only sent when the user actually
        // typed an override; an empty field means "use the server default".
        body.model = modelInput.trim();
      }
      const res = await fetch('/api/ai/key', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'This key was rejected -- nothing was saved.'));
      setApiKeyInput('');
      setIsEditing(false);
      // So a PolishButton that mounts LATER in this SAME browser tab (not
      // an already-open one elsewhere -- see useAiKeyStatus.ts's own doc
      // comment for why that reach is narrower than it might sound) picks
      // up the newly-saved key without a full reload.
      invalidateAiKeyStatusCache();
      await loadStatus();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'This key was rejected -- nothing was saved.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    if (typeof window !== 'undefined' && !window.confirm('Remove your saved AI key? You can add a new one at any time.')) {
      return;
    }
    setIsRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch('/api/ai/key', { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok && res.status !== 204) throw new Error(await readApiError(res, 'Failed to remove the AI key.'));
      invalidateAiKeyStatusCache();
      setApiKeyInput('');
      setProvider('anthropic');
      setBaseUrlInput('');
      setModelInput('');
      setIsEditing(true);
      await loadStatus();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove the AI key.');
    } finally {
      setIsRemoving(false);
    }
  }

  function handleCancelEdit() {
    setIsEditing(false);
    setApiKeyInput('');
    setSaveError(null);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionKicker}>AI Polish (Bring Your Own Key)</div>
      <p className={styles.sectionCopy}>
        Add your own API key to enable the &quot;Polish&quot; button next to report text fields -- it rewrites what
        you typed in Foundation First&apos;s house voice, tailored to that specific field, and never changes
        anything until you accept the suggestion. Works with Anthropic directly, or any OpenAI-compatible provider
        (OpenRouter, OpenAI, Groq, and most other hosted LLM providers). The key is encrypted and stored
        server-side; it never reaches your browser again once saved, and this app never sees it in plaintext except
        for the moment you save it. Each polish sends the field text (plus a small amount of context, such as the
        client name on a risk) to your chosen provider under your own key -- cost accrues to your own account
        there, not this app.
      </p>

      {serverAvailable === false ? (
        <div className={styles.notConfiguredNotice} role="alert">
          AI polish isn&apos;t configured on the server yet (<code>AI_BYOK_ENCRYPTION_KEY</code> is missing) -- an
          administrator needs to set that value and restart the app before a key can be saved here.
        </div>
      ) : null}

      {loadError ? (
        <p className={styles.fieldError} role="alert">
          {loadError}
        </p>
      ) : null}

      {serverAvailable && status && !isEditing ? (
        <div className={styles.statusBlock}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Provider</span>
            <span className={styles.statusValue}>{providerLabel(status.provider)}</span>
          </div>
          {status.provider === 'openai_compatible' && status.baseUrl ? (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Base URL</span>
              <code className={styles.statusValue}>{status.baseUrl}</code>
            </div>
          ) : null}
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Model</span>
            <code className={styles.statusValue}>{status.model || 'Default'}</code>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Key</span>
            <code className={styles.statusValue}>{status.hint || '(configured)'}</code>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Validated</span>
            <span className={styles.statusValue}>{status.validatedAt ? fmtDateShort(status.validatedAt) : '--'}</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Last Used</span>
            <span className={styles.statusValue}>{status.lastUsedAt ? fmtDateShort(status.lastUsedAt) : 'Never'}</span>
          </div>
          <div className={styles.templateRow}>
            <Button variant="outline" size="sm" onClick={handleStartReplace}>
              Replace Key
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemove} disabled={isRemoving}>
              {isRemoving ? 'Removing…' : 'Remove Key'}
            </Button>
          </div>
          {removeError ? (
            <p className={styles.fieldError} role="alert">
              {removeError}
            </p>
          ) : null}
        </div>
      ) : null}

      {serverAvailable && isEditing ? (
        <div className={styles.editForm}>
          <div className={styles.providerRow}>
            <Select
              label="Provider"
              value={provider}
              onChange={handleProviderChange}
              options={PROVIDER_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            />
          </div>

          <div className={styles.controlsRow}>
            <div className={styles.keyInputWrap}>
              <Input
                label={provider === 'openai_compatible' ? 'API Key' : 'Anthropic API Key'}
                type="password"
                placeholder={provider === 'openai_compatible' ? 'sk-or-...' : 'sk-ant-...'}
                value={apiKeyInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKeyInput(e.target.value)}
              />
            </div>
          </div>

          {provider === 'openai_compatible' ? (
            <div className={styles.controlsRow}>
              <div className={styles.keyInputWrap}>
                <Input
                  label="Base URL"
                  placeholder="https://openrouter.ai/api/v1"
                  value={baseUrlInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setBaseUrlInput(e.target.value)}
                />
              </div>
              <div className={styles.keyInputWrap}>
                <Input
                  label="Model"
                  placeholder="anthropic/claude-sonnet-5"
                  value={modelInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setModelInput(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className={styles.controlsRow}>
              <div className={styles.keyInputWrap}>
                <Input
                  label="Model (optional)"
                  placeholder="claude-sonnet-5 (default)"
                  value={modelInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setModelInput(e.target.value)}
                />
              </div>
            </div>
          )}

          {provider === 'openai_compatible' ? (
            <p className={styles.helperText}>
              The base URL must be your provider&apos;s OpenAI-compatible API root (Chat Completions is appended
              automatically) -- e.g. <code>https://openrouter.ai/api/v1</code> for OpenRouter, or{' '}
              <code>https://api.groq.com/openai/v1</code> for Groq. Both the base URL and model are validated
              against the provider before anything is saved. Note: OpenAI&apos;s own <code>o1</code>/<code>o3</code>{' '}
              models, hit directly at <code>api.openai.com</code>, are not supported here (they require{' '}
              <code>max_completion_tokens</code> instead of <code>max_tokens</code>) -- OpenRouter, Groq, Together,
              and most other gateways are unaffected.
            </p>
          ) : null}

          <div className={styles.saveButtonWrap}>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving || !canSave}>
              {isSaving ? 'Validating…' : 'Save Key'}
            </Button>
            {status?.configured ? (
              <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {saveError ? (
        <p className={styles.fieldError} role="alert">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}
