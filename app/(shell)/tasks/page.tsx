'use client';

import { TaskViewScreen } from '@/components/tasks/TaskViewScreen';
import { useReports } from '@/lib/hooks/useReports';

/**
 * `/tasks` -- thin route wrapper (mirrors `app/(shell)/page.tsx`): owns
 * `useReports()` and renders nothing until `reports !== null`, so there is
 * no localStorage-during-SSR and no hydration mismatch (see `useReports`).
 * All Task-view state/logic lives in `TaskViewScreen`.
 */
export default function TasksPage() {
  const { reports, updateReportFields } = useReports();

  if (reports === null) return null;

  return <TaskViewScreen reports={reports} onUpdateReportFields={updateReportFields} />;
}
