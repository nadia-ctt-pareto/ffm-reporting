'use client';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import type { ReportKind } from '@/lib/types';
import styles from './ShareDialog.module.css';

export interface ShareDialogProps {
  open: boolean;
  reportId: string | null;
  /** Phase 4: which present route to link to (`/reports/:id/present` vs `/daily/:id/present`). Defaults to 'weekly' -- every pre-Phase-4 call site keeps working unchanged. */
  kind?: ReportKind;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}

/**
 * Points at the real `/reports/[id]/present` (weekly) or `/daily/[id]/present`
 * (Phase 4, daily) slide-deck route. SSR-guarded (`window` doesn't exist on
 * the server) -- falls back to a relative path, which is fine since this is
 * only ever rendered/copied client-side (see ReportScreen / WizardPage).
 */
export function shareLinkFor(reportId: string | null, kind: ReportKind = 'weekly'): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const base = kind === 'daily' ? '/daily' : '/reports';
  return `${origin}${base}/${reportId ?? ''}/present`;
}

export function ShareDialog({ open, reportId, kind = 'weekly', copied, onCopy, onClose }: ShareDialogProps) {
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
            "Anyone with this link sees a read-only, branded presentation of this report — but only in a browser whose local storage already has it. This MVP's persistence is per-browser (localStorage); true cross-machine sharing arrives with the Supabase cutover."
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
