'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort } from '@/lib/format';
import styles from './McpAccessSection.module.css';

interface ApiTokenSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

const COLUMNS: TableColumn[] = [
  { key: 'label', label: 'Label' },
  { key: 'created', label: 'Created' },
  { key: 'lastUsed', label: 'Last Used' },
  { key: 'status', label: 'Status' },
  { key: 'action', label: '', isAction: true },
];

function statusBadge(token: ApiTokenSummary) {
  if (token.revokedAt) return <Badge tone="negative">Revoked</Badge>;
  if (token.expiresAt && token.expiresAt <= new Date().toISOString()) return <Badge tone="warning">Expired</Badge>;
  return <Badge tone="positive">Active</Badge>;
}

/**
 * Settings section (Phase 8a), mounted only in Supabase mode -- same gate
 * as `LocalDataImportSection` (see SettingsScreen.tsx) -- MCP bearer tokens
 * have no meaning in demo mode (no auth, no per-user ownership to scope a
 * token to). Owns its own fetch/create/revoke state directly against
 * `/api/tokens*` (no `useReports()`-style hook: this is a small,
 * self-contained CRUD surface with nothing else in the app that needs to
 * react to it -- unlike reports/projects, no other screen reads token
 * state).
 *
 * The plaintext token value is shown EXACTLY ONCE, immediately after
 * creation (`POST /api/tokens`'s own response body) -- it is never
 * re-fetched or re-displayed; `GET /api/tokens` (the list below) only ever
 * returns the non-secret columns (see app/api/tokens/route.ts). Every token
 * acts as its creator: it can read every report (org-wide, same as the
 * dashboard) but can only create/edit reports it owns, and it can NEVER
 * delete a report -- there is no delete tool (see
 * skills/weekly-reports/SKILL.md's "Access model"). This applies even to an
 * admin's own token: Phase 8a mints no `app_metadata`, so `is_admin()` is
 * false for every MCP call regardless of who created the token.
 *
 * `GET /api/tokens`'s `endpointReady` flag (`isMcpConfigured()`,
 * lib/server/mcp-auth.ts) is surfaced as a notice, not a disabled state --
 * this section is gated on `isSupabaseConfigured()` alone, so it renders
 * even when `SUPABASE_JWT_SECRET` is missing (a distinct, non-fatal
 * misconfiguration: Supabase is set up, but the MCP endpoint itself will
 * 404 every call until that secret is set). Token CREATION stays enabled in
 * that state on purpose -- an operator may genuinely be setting things up
 * in stages -- the notice just explains why a freshly-minted token won't
 * work yet, instead of leaving that as a silent, confusing 404 the first
 * time `claude mcp add` is actually run.
 */
export function McpAccessSection() {
  const [tokens, setTokens] = useState<ApiTokenSummary[] | null>(null);
  const [endpointReady, setEndpointReady] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ value: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadTokens();
  }, []);

  async function loadTokens() {
    try {
      const res = await fetch('/api/tokens', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to load tokens.'));
      const body = (await res.json()) as { tokens: ApiTokenSummary[]; endpointReady: boolean };
      setTokens(body.tokens);
      setEndpointReady(body.endpointReady);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load tokens.');
    }
  }

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to create a token.'));
      const body = (await res.json()) as { value: string };
      setJustCreated({ value: body.value });
      setLabel('');
      await loadTokens();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create a token.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok && res.status !== 204) throw new Error(await readApiError(res, 'Failed to revoke this token.'));
      await loadTokens();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to revoke this token.');
    } finally {
      setRevokingId(null);
    }
  }

  function copyToken(value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  }

  const rows =
    tokens?.map((token) => ({
      label: token.label || '(unlabeled)',
      created: fmtDateShort(token.createdAt),
      lastUsed: token.lastUsedAt ? fmtDateShort(token.lastUsedAt) : 'Never',
      status: statusBadge(token),
      action: token.revokedAt ? null : (
        <Button variant="outline" size="sm" onClick={() => handleRevoke(token.id)} disabled={revokingId === token.id}>
          {revokingId === token.id ? 'Revoking…' : 'Revoke'}
        </Button>
      ),
    })) ?? [];

  const mcpUrl = `${origin || ''}/api/mcp`;

  return (
    <section className={styles.section}>
      <div className={styles.sectionKicker}>Claude (MCP) Access</div>
      <p className={styles.sectionCopy}>
        Create a token to let Claude read and write reports through this app&apos;s MCP server. Every token acts as YOU: it
        can read every report (same as the dashboard) but can only create or edit reports it owns, and it can never delete
        a report. Revoke a token any time to cut off access immediately.
      </p>

      {endpointReady === false ? (
        <div className={styles.notConfiguredNotice} role="alert">
          The MCP endpoint isn&apos;t configured on the server yet (<code>SUPABASE_JWT_SECRET</code> is missing) -- you can
          still create tokens below, but Claude won&apos;t be able to use one until an administrator sets that value and
          restarts the app.
        </div>
      ) : null}

      {justCreated ? (
        <div className={styles.tokenReveal}>
          <div className={styles.tokenRevealHeading}>Copy this token now — it won&apos;t be shown again.</div>
          <code className={styles.tokenValue}>{justCreated.value}</code>
          <div className={styles.templateRow}>
            <Button variant="outline" size="sm" onClick={() => copyToken(justCreated.value)}>
              Copy Token
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setJustCreated(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.controlsRow}>
        <div className={styles.labelWrap}>
          <Input
            label="Label"
            placeholder="e.g. Claude Desktop"
            value={label}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
          />
        </div>
        <div className={styles.createButtonWrap}>
          <Button variant="primary" size="sm" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? 'Creating…' : 'Create Token'}
          </Button>
        </div>
      </div>
      {createError ? (
        <p className={styles.fieldError} role="alert">
          {createError}
        </p>
      ) : null}
      {loadError ? (
        <p className={styles.fieldError} role="alert">
          {loadError}
        </p>
      ) : null}

      {tokens && tokens.length > 0 ? (
        <div className={styles.tableWrap}>
          <Table stacked columns={COLUMNS} rows={rows} />
        </div>
      ) : tokens && tokens.length === 0 ? (
        <p className={styles.sectionCopy}>No tokens yet.</p>
      ) : null}

      <div className={styles.setupBlock}>
        <div className={styles.setupHeading}>Connect Claude Code</div>
        <p className={styles.sectionCopy}>Run this after creating a token above, pasting the token in place of &lt;TOKEN&gt;:</p>
        <pre className={styles.codeBlock}>{`claude mcp add --transport http weekly-reports ${mcpUrl} --header "Authorization: Bearer <TOKEN>"`}</pre>
      </div>
    </section>
  );
}
