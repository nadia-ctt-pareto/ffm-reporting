'use client';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { fmtWeekLabel } from '@/lib/format';
import type { Report } from '@/lib/types';
import styles from './PdfDialog.module.css';

export interface PdfDialogProps {
  open: boolean;
  // Resolved from the persisted reports list (design-source line 719 also
  // falls back to the in-progress wizard draft when draft.id === pdfReportId,
  // but that fallback is unreachable here: the wizard's publish() upserts the
  // report into `reports` synchronously, before its confirmation screen's
  // "Download PDF" button can ever be clicked -- see WeeklyReportsApp).
  report: Report | null;
  onClose: () => void;
}

export function PdfDialog({ open, report, onClose }: PdfDialogProps) {
  const label = report ? fmtWeekLabel(report.weekStart, report.weekEnd) : 'this report';

  return (
    <Dialog open={open} onClose={onClose} title="Export PDF" width={440}>
      <div>
        <p className={styles.lead}>Preparing a PDF export of {label}.</p>
        <p className={styles.disclaimer}>
          {"Prototype — PDF rendering isn't wired up yet; it will be built out in the full version."}
        </p>
        <div className={styles.closeRow}>
          <Button variant="dark" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
