'use client';

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
 * a failed write. This call site was missed when that contract landed --
 * `onUpdateReportFields` was passed straight through and invoked bare in
 * `KanbanBoard`'s drop handler, so a denied PATCH (e.g. `member@` dragging a
 * `dev@`-owned report's task under Supabase RLS) produced an unhandled
 * promise rejection (React 19's dev overlay / a raw `unhandledrejection`) on
 * top of the card silently snapping back with zero explanation. `.catch(() =>
 * {})` here mirrors the two report-detail page wrappers
 * (app/(shell)/reports/[id]/page.tsx, app/(shell)/daily/[id]/page.tsx);
 * `mutationError` is threaded through so the snap-back at least reads as a
 * visible error instead of "the app broke".
 */
export default function TasksPage() {
  const { reports, loadError, updateReportFields, mutationError } = useReports();

  // Post-review hardening round 2 (SHOULD-FIX H): a failed initial load
  // used to leave `reports` null forever with nothing rendering `loadError`
  // -- see DashboardPage.tsx's identical guard for the full rationale.
  if (reports === null) {
    if (loadError) return <LoadErrorState title="Tasks" message={loadError} />;
    return null;
  }

  return (
    <TaskViewScreen
      reports={reports}
      mutationError={mutationError}
      onUpdateReportFields={(id, patch) => {
        updateReportFields(id, patch).catch(() => {});
      }}
    />
  );
}
