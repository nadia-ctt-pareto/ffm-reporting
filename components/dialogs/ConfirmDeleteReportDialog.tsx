'use client';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconTrash } from '@/components/ui/icons';
import { reportPeriodLabel } from '@/lib/report-utils';
import type { AnyReport } from '@/lib/types';
import styles from './ConfirmDeleteReportDialog.module.css';

export interface ConfirmDeleteReportDialogProps {
  open: boolean;
  /**
   * The report pending deletion -- used ONLY for this dialog's kind-aware
   * title ("Delete Weekly Report" / "Delete Daily Report") and its
   * period-label copy ("Delete the report for {period}?", via
   * `reportPeriodLabel`). `null` is a valid, expected value while the
   * dialog is closed (every caller keys `open` off having a real selection
   * already, so a `null` report is never actually shown to a user) --
   * nullable specifically so callers don't have to invent/hold a dummy
   * report just to satisfy this prop between selections.
   */
  report: AnyReport | null;
  isDeleting: boolean;
  /**
   * A curated failure message (Supabase mode, via `curatedMessage` server-
   * side) or a plain `Error.message` (demo mode's `LocalStorageReportsRepository`
   * throws a raw `Error`, never a `ServiceError`) -- rendered inline,
   * left up to the caller's own `onConfirm` handler to set/clear.
   */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Phase 8d (report delete): the one shared "delete this report" confirmation dialog -- structurally
 * copied from `ProjectDetailScreen`'s own delete dialog (Phase 8c), reused by
 * THREE callers instead of three near-identical copies:
 *
 *   - `ReportScreen` (`/reports/[id]`, `/daily/[id]`) -- owns its own
 *     open/isDeleting/error state directly, the same "no separate
 *     orchestrator" pattern this route already uses for its Share dialog.
 *   - `DashboardPage`/`DailyPage` (`/reports`, `/daily`) -- own that state at
 *     the route-orchestrator level instead, since a row-level Delete button
 *     has no per-row component of its own to hold it (see those files' own
 *     doc comments for why dialog HOSTING lives there, matching this
 *     codebase's existing "Page owns dialogs, Screen stays presentational"
 *     split for every other list-level dialog).
 *
 * Purely presentational and stateless beyond its own props: every caller
 * supplies `onConfirm` (which calls its own hook's `deleteReport(id)` and
 * manages `isDeleting`/`error` around that call) and decides for itself what
 * happens on success. In every current call site that "what happens on
 * success" is just closing the dialog -- a route-level `notFound` effect,
 * derived from the SAME hook state `deleteReport` mutates, is the single
 * place that actually navigates away afterward (see CLAUDE.md's Phase 8c
 * "SHOULD-FIX 2" precedent this deliberately follows: an optimistic removal
 * -- or a dialog that navigates on its own -- risks unmounting mid-request
 * on a failure and silently swallowing this component's own `error` prop).
 * This component itself never calls a router and never touches `useReports`/
 * `useDailyReports` directly, by design.
 */
export function ConfirmDeleteReportDialog({ open, report, isDeleting, error, onCancel, onConfirm }: ConfirmDeleteReportDialogProps) {
  const kindLabel = report?.kind === 'daily' ? 'Daily Report' : 'Weekly Report';
  const periodLabel = report ? reportPeriodLabel(report) : '';

  return (
    <Dialog open={open} onClose={onCancel} title={`Delete ${kindLabel}`} width={440}>
      <div>
        <p className={styles.dialogNote}>
          Delete the report for {periodLabel}? This permanently removes its tasks, risks, and priorities, and any share
          link to it stops working. This cannot be undone.
        </p>
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="dangerSolid" size="sm" icon={<IconTrash />} onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete Report'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
