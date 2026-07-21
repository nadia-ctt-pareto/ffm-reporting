'use client';

// Phase 7c (BYOK AI field polish): "AI Polish (Bring Your Own Key)" settings
// section. RECONCILIATION DELTA: modeled directly on `McpAccessSection.tsx`
// -- same Supabase-mode gate (SettingsScreen.tsx mounts this only when
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

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fmtDateShort } from '@/lib/format';
import { invalidateAiKeyStatusCache } from '@/lib/hooks/useAiKeyStatus';
import styles from './AiKeySection.module.css';

interface AiKeyStatusBody {
  configured: boolean;
  hint: string;
  validatedAt: string | null;
  lastUsedAt: string | null;
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
      setIsEditing((prev) => prev || !body.configured);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the AI key status.');
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      // NIT (post-review): trim before sending -- SetAiKeyInputSchema caps
      // the RAW string at 200 chars and `setAiKey` (lib/server/ai-keys.ts)
      // only trims AFTER validation, so a pasted key with stray leading/
      // trailing whitespace could otherwise land right on (or past) that
      // boundary and 400 for a reason the user can't see.
      const res = await fetch('/api/ai/key', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'This key was rejected by Anthropic -- nothing was saved.'));
      setApiKeyInput('');
      setIsEditing(false);
      // So a PolishButton that mounts LATER in this SAME browser tab (not
      // an already-open one elsewhere -- see useAiKeyStatus.ts's own doc
      // comment for why that reach is narrower than it might sound) picks
      // up the newly-saved key without a full reload.
      invalidateAiKeyStatusCache();
      await loadStatus();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'This key was rejected by Anthropic -- nothing was saved.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    if (typeof window !== 'undefined' && !window.confirm('Remove your saved Anthropic key? You can add a new one at any time.')) {
      return;
    }
    setIsRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch('/api/ai/key', { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok && res.status !== 204) throw new Error(await readApiError(res, 'Failed to remove the AI key.'));
      invalidateAiKeyStatusCache();
      setApiKeyInput('');
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
        Add your own Anthropic API key to enable the &quot;Polish&quot; button next to report text fields -- it
        rewrites what you typed in Foundation First&apos;s house voice, tailored to that specific field, and never
        changes anything until you accept the suggestion. The key is encrypted and stored server-side; it never
        reaches your browser again once saved, and this app never sees it in plaintext except for the moment you
        save it. Each polish sends the field text (plus a small amount of context, such as the client name on a
        risk) to Anthropic under your own key -- cost accrues to your Anthropic account, not this app.
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
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
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
        <div className={styles.controlsRow}>
          <div className={styles.keyInputWrap}>
            <Input
              label="Anthropic API Key"
              type="password"
              placeholder="sk-ant-..."
              value={apiKeyInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKeyInput(e.target.value)}
            />
          </div>
          <div className={styles.saveButtonWrap}>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving || apiKeyInput.trim().length === 0}>
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
