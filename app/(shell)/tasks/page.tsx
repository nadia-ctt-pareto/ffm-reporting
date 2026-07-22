'use client';

import { Suspense } from 'react';
import { LoadErrorState } from '@/components/app/LoadErrorState';
import { TaskViewScreen } from '@/components/tasks/TaskViewScreen';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/tasks` -- thin route wrapper (mirrors `app/(shell)/page.tsx`): owns
 * `useReports()` and renders nothing until `reports !== null`, so there is
 * no localStorage-during-SSR and no hydration mismatch (see `useReports`).
 * All Task-view state/logic lives in `TaskViewScreen`.
 *
 * BLOCKER 3 fix (Phase 7b): `updateReportFields` now returns `Promise<void>`
 * (Phase 7b's failure-resilience contract, see useReports.ts) and REJECTS on
 * a failed write.
 *
 * Task CRUD follow-up: the `.catch(() => {})` that used to live HERE (see
 * this comment's own prior revision) moved down into `TaskViewScreen`'s
 * `handleTaskStatusChange` instead of staying at this call site. Reason:
 * `TaskDialog`'s Save/Add/Delete actions now ALSO go through
 * `onUpdateReportFields`, and THEY need to `await` its real resolve/reject
 * outcome to decide "close the dialog" vs. "show an inline error and stay
 * open" -- swallowing the rejection here, before it ever reaches
 * `TaskViewScreen`, would make that impossible. So this wrapper now passes
 * `updateReportFields` straight through, unwrapped, and `TaskViewScreen`
 * itself decides per call site whether to `.catch(() => {})` (the Kanban
 * drag path, unchanged end-user behavior) or `await` it directly (the
 * dialog's Save/Add/Delete, new in this change) -- see that component's own
 * doc comments. `mutationError` is still threaded through so the Kanban
 * drag's snap-back still reads as a visible error instead of "the app
 * broke".
 *
 * Schedule tab follow-up: `TaskViewScreen` now reads `useSearchParams()`
 * itself (`?view=`/`?filter=` deep-linking into the new Schedule tab -- see
 * that component's own doc comment), so `next build` requires a `<Suspense>`
 * boundary somewhere above it or static prerendering of this route fails --
 * the exact same requirement `app/(shell)/settings/page.tsx` already
 * satisfies for `SettingsScreen`'s `?tab=`. `TasksPageContent` is split out
 * so the boundary wraps the `useReports()` call too (simpler than threading
 * a second inner boundary around just `<TaskViewScreen>`), which is fine --
 * `useReports()` doesn't read `useSearchParams()` itself, so nothing about
 * its own behavior changes.
 */
function TasksPageContent() {
  const { reports, loadError, updateReportFields, mutationError } = useReports();

  // Post-review hardening round 2 (SHOULD-FIX H): a failed initial load
  // used to leave `reports` null forever with nothing rendering `loadError`
  // -- see DashboardPage.tsx's identical guard for the full rationale.
  if (reports === null) {
    if (loadError) return <LoadErrorState title="Tasks" message={loadError} />;
    return null;
  }

  return <TaskViewScreen reports={reports} mutationError={mutationError} onUpdateReportFields={updateReportFields} />;
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksPageContent />
    </Suspense>
  );
}
