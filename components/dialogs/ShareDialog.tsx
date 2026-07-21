'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { ReportKind } from '@/lib/types';
import styles from './ShareDialog.module.css';

export interface ShareDialogProps {
  open: boolean;
  reportId: string | null;
  /** Phase 4: which present route to link to (`/reports/:id/present` vs `/daily/:id/present`). Defaults to 'weekly' -- every pre-Phase-4 call site keeps working unchanged. */
  kind?: ReportKind;
  /**
   * Demo-mode only (see the component doc comment below). Ignored entirely
   * in Supabase mode -- that branch owns its own copy-confirmation state,
   * since it also owns the async enable/revoke/fetch work a demo-mode
   * caller (ReportScreen, WizardPage) has no reason to know about.
   */
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}

/**
 * Points at the real `/reports/[id]/present` (weekly) or `/daily/[id]/present`
 * (Phase 4, daily) slide-deck route. SSR-guarded (`window` doesn't exist on
 * the server) -- falls back to a relative path, which is fine since this is
 * only ever rendered/copied client-side (see ReportScreen / WizardPage).
 *
 * Phase 7b (M3): an optional `token` appends `?t=<token>` -- the anonymous,
 * cross-machine share link (see app/reports/[id]/present/page.tsx's
 * `resolveShared`). Omitted entirely in demo mode and whenever sharing
 * isn't enabled yet (Supabase mode, no token) -- both keep resolving to the
 * bare (session-gated) present URL, exactly as before.
 */
export function shareLinkFor(reportId: string | null, kind: ReportKind = 'weekly', token?: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const base = kind === 'daily' ? '/daily' : '/reports';
  const path = `${origin}${base}/${reportId ?? ''}/present`;
  return token ? `${path}?t=${token}` : path;
}

/**
 * `ShareDialog` itself just picks a branch based on `isSupabaseConfigured()`
 * -- a pure, build-time-inlined env check (see lib/supabase/config.ts), so
 * this never changes mid-session and never causes a hydration mismatch.
 * Delegating to two separate components (rather than one component with
 * conditional hook calls) is deliberate: `SupabaseShareDialog` owns real
 * async state (fetch-on-open, enable, revoke) that `DemoShareDialog` has no
 * reason to carry, and mixing the two in one function body would mean
 * calling hooks conditionally.
 *
 * Post-review fix: `key={props.reportId}` on the Supabase branch. Without
 * it, a single `ShareDialog` mount reused across different report ids (the
 * wizard's publish-confirmation screen calls `openShare(id)` for whichever
 * report was just published, reusing one long-lived mount rather than
 * remounting per report) could render one commit where the URL/state still
 * reflected the PREVIOUS id's token -- `SupabaseShareDialog`'s own
 * open/reportId effect only resets `token`/`status` from inside a `useEffect`,
 * which runs AFTER that stale commit paints. Keying by `reportId` forces a
 * full remount (fresh `useState` initial values) the instant the id changes,
 * so there is no commit in which the new id and the old token can appear
 * together.
 */
export function ShareDialog(props: ShareDialogProps) {
  return isSupabaseConfigured() ? <SupabaseShareDialog key={props.reportId ?? 'none'} {...props} /> : <DemoShareDialog {...props} />;
}

/** Phase 1-6, byte-for-byte: a static link (this MVP's persistence is per-browser localStorage) + a parent-controlled copied/onCopy pair. Untouched by Phase 7b -- CLAUDE.md's "demo mode must keep working." */
function DemoShareDialog({ open, reportId, kind = 'weekly', copied, onCopy, onClose }: ShareDialogProps) {
  const link = shareLinkFor(reportId, kind);

  return (
    <Dialog open={open} onClose={onClose} title="Share This Report" width={480}>
      <div>
        <Input label="Viewer Link" value={link} readOnly />
        <div className={styles.copyRow}>
          <Button variant="primary" size="sm" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy Link'}
          </Button>
        </div>
        <p className={styles.disclaimer}>
          {
            "Anyone with this link sees a read-only, interactive presentation of this report — but only in a browser whose local storage already has it. This MVP's persistence is per-browser (localStorage); true cross-machine sharing arrives with the Supabase cutover."
          }
        </p>
        <div className={styles.closeRow}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type ShareStatus = 'loading' | 'ready' | 'enabling' | 'revoking';

function shareErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function readShareApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Phase 7b (M3): Supabase-mode sharing -- a real, cross-machine public link
 * backed by `GET`/`POST`/`DELETE /api/reports/[id]/share`
 * (app/api/reports/[id]/share/route.ts), which are owner-or-admin-gated
 * SECURITY DEFINER RPCs server-side (see that route's header comment). This
 * component fetches the CURRENT token every time the dialog opens for a
 * (possibly different) report id -- both `open` and `reportId` are in the
 * effect's dependency array, since the wizard's publish-confirmation screen
 * reuses one `ShareDialog` mount across different reports via its own
 * `shareReportId` state.
 *
 * Calls `fetch` directly against the share route rather than going through
 * `getReportsRepository()` -- sharing was never part of the
 * `ReportsRepository` interface (it isn't a report-shaped read/write; see
 * `lib/data/reports-repository.ts`), so there is nothing to route through.
 */
function SupabaseShareDialog({ open, reportId, kind = 'weekly', onClose }: ShareDialogProps) {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<ShareStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    []
  );

  useEffect(() => {
    if (!open || !reportId) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setCopied(false);
    setToken(null);
    fetch(`/api/reports/${encodeURIComponent(reportId)}/share`, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readShareApiError(res, 'Failed to load sharing status.'));
        return (await res.json()) as { shareToken: string | null };
      })
      .then(({ shareToken }) => {
        if (cancelled) return;
        setToken(shareToken);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(shareErrorMessage(err, 'Failed to load sharing status.'));
        setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportId]);

  const enable = async () => {
    if (!reportId) return;
    setStatus('enabling');
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/share`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readShareApiError(res, 'Failed to enable sharing.'));
      // Post-review fix: the route handler always returns `{ token }` on a
      // 2xx (app/api/reports/[id]/share/route.ts), but the response is cast,
      // not validated -- a missing `token` would otherwise set `token` to
      // `undefined` (falsy), silently re-rendering the "Enable" UI even
      // though the server-side write succeeded. Treat that shape mismatch as
      // an error instead, so it's visible rather than looking like a no-op.
      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new Error('Sharing may have been enabled, but the server response was unexpected. Reopen this dialog to check its status.');
      setToken(body.token);
    } catch (err) {
      setError(shareErrorMessage(err, 'Failed to enable sharing.'));
    } finally {
      setStatus('ready');
    }
  };

  const revoke = async () => {
    if (!reportId) return;
    setStatus('revoking');
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/share`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readShareApiError(res, 'Failed to revoke sharing.'));
      setToken(null);
    } catch (err) {
      setError(shareErrorMessage(err, 'Failed to revoke sharing.'));
    } finally {
      setStatus('ready');
    }
  };

  const copyLink = () => {
    if (!token) return;
    const link = shareLinkFor(reportId, kind, token);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const busy = status === 'loading' || status === 'enabling' || status === 'revoking';

  return (
    <Dialog open={open} onClose={onClose} title="Share This Report" width={480}>
      <div>
        {status === 'loading' ? (
          <p className={styles.disclaimer}>Checking sharing status…</p>
        ) : token ? (
          <>
            <Input label="Public Link" value={shareLinkFor(reportId, kind, token)} readOnly />
            <div className={styles.copyRow}>
              <Button variant="outline" size="sm" onClick={revoke} disabled={busy}>
                {status === 'revoking' ? 'Revoking…' : 'Revoke Link'}
              </Button>
              <Button variant="primary" size="sm" onClick={copyLink} disabled={busy}>
                {copied ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
            <p className={styles.disclaimer}>
              Anyone with this link sees a read-only, interactive presentation of this report -- from any device, no
              account required -- until you revoke it.
            </p>
          </>
        ) : (
          <>
            <p className={styles.disclaimer}>
              This report isn&apos;t shared yet. Enabling a public link lets anyone who has it view a read-only,
              interactive presentation -- from any device, no account required -- until you revoke it.
            </p>
            <div className={styles.copyRow}>
              <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
                {status === 'enabling' ? 'Enabling…' : 'Enable Public Link'}
              </Button>
            </div>
          </>
        )}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.closeRow}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
