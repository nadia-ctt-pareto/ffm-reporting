'use client';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import styles from './ShareDialog.module.css';

export interface ShareDialogProps {
  open: boolean;
  reportId: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}

/**
 * Points at the real `/reports/[id]/present` slide-deck route (Phase 2).
 * SSR-guarded (`window` doesn't exist on the server) -- falls back to a
 * relative path, which is fine since this is only ever rendered/copied
 * client-side (see ReportScreen / WizardPage).
 */
export function shareLinkFor(reportId: string | null): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/reports/${reportId ?? ''}/present`;
}

export function ShareDialog({ open, reportId, copied, onCopy, onClose }: ShareDialogProps) {
  const link = shareLinkFor(reportId);

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
