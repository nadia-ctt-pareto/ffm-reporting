'use client';

import { PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import styles from './LoadErrorState.module.css';

export interface LoadErrorStateProps {
  title: string;
  message: string;
}

/**
 * NIT fix (post-review round 2): missing `'use client'` above worked only
 * because every current importer is already a client component -- a future
 * SERVER component importing this (for `onClick`/`window.location.reload()`
 * below) would fail at build. Added explicitly rather than relying on that.
 *
 * Post-review hardening (SHOULD-FIX 11): every shell screen's route
 * wrapper (`DashboardPage`, `DailyPage`, ...) rendered `null` while
 * `reports === null` -- correct for "still loading," but a failed initial
 * read (Supabase unreachable, a non-401 server error) ALSO left `reports`
 * `null` forever, since nothing ever consumed `useReports()`'s `loadError`.
 * The result: sidebar plus a permanently blank white content pane, no
 * error, no retry -- reads as "the app broke," not "something failed and
 * here's what to do." A simple `window.location.reload()` is the right
 * "retry" here (not a re-`fetch` via the hook) -- the failure could be
 * transient network flakiness OR a session that needs `middleware.ts` to
 * re-evaluate on a fresh document navigation.
 */
export function LoadErrorState({ title, message }: LoadErrorStateProps) {
  return (
    <div>
      <PageHeader title={title} />
      <div className={styles.content}>
        <p className={styles.message}>{message}</p>
        <Button variant="outline" size="md" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
