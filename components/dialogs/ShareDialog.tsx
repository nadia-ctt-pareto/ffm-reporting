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

/** Line 626 */
export function shareLinkFor(reportId: string | null): string {
  return 'https://reports.foundationfirstmarketing.com/r/' + (reportId ?? '');
}

export function ShareDialog({ open, reportId, copied, onCopy, onClose }: ShareDialogProps) {
  const link = shareLinkFor(reportId);

  return (
    <Dialog open={open} onClose={onClose} title="Share This Report" width={480}>
      <div>
        <div style={{ width: 150 }}>
          <Input label="Viewer Link" value={link} readOnly />
        </div>
        <div className={styles.copyRow}>
          <Button variant="primary" size="sm" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy Link'}
          </Button>
        </div>
        <p className={styles.disclaimer}>
          {
            "Anyone with this link sees a read-only view of this report. Prototype — the link isn't live yet; it will be wired up in the full build."
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
