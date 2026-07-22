'use client';

import { LoadErrorState } from '@/components/app/LoadErrorState';
import { HomeScreen } from '@/components/home/HomeScreen';
import { useAssignedTasks } from '@/lib/hooks/useAssignedTasks';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useReports } from '@/lib/hooks/useReports';
import { useSession } from '@/lib/hooks/useSession';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { mergeTaskSources } from '@/lib/task-merge';

/**
 * Route-level orchestration for `/` (the Home overview). Loads both report
 * kinds (mirrors `DashboardPage`/`DailyPage`'s null-guard + `LoadErrorState`
 * pattern) and hands them to the presentational `HomeScreen`. Renders nothing
 * until BOTH lists resolve, so there is no localStorage-during-SSR / hydration
 * mismatch; a failed load on either surfaces an actionable error screen.
 *
 * WP4 (the access flip's task-surface follow-up): also loads the viewer's own
 * assigned-elsewhere tasks (`useAssignedTasks()`, always `[]` in demo mode)
 * and the session (`useSession()`, for `canEditReport`'s ownership check),
 * then builds the ONE shared merged task set (`mergeTaskSources`, lib/
 * task-merge.ts) here, once, and passes it down -- `HomeScreen` stays purely
 * presentational, same as before this package. `assignedTasks` is treated as
 * a graceful-degrade input (`?? []`), NOT gated on its own loading state --
 * same "harmless default while loading" posture `teamMembers` already gets
 * at `/tasks` (see `TaskViewScreen.tsx`) -- gating the whole page render on
 * a THIRD fetch resolving would delay Home's first paint for a list that's
 * usually empty anyway. `sessionLoading` is passed straight into `access`
 * rather than gating render too: `canEditReport` already treats a
 * still-resolving session as "not editable yet," which only ever makes a
 * control SETTLE from disabled to enabled once the session resolves, never
 * the reverse -- the same principle `lib/report-access.ts`'s
 * `canDeleteReport` documents.
 */
export function HomePage() {
  const { reports: weeklies, loadError: weekliesError } = useReports();
  const { reports: dailies, loadError: dailiesError } = useDailyReports();
  const { tasks: assignedTasks } = useAssignedTasks();
  const { user, loading: sessionLoading } = useSession();

  if (weeklies === null || dailies === null) {
    const err = weekliesError ?? dailiesError;
    if (err) return <LoadErrorState title="Home" message={err} />;
    return null;
  }

  const mergedTasks = mergeTaskSources([...weeklies, ...dailies], assignedTasks ?? [], {
    user,
    loading: sessionLoading,
    supabaseConfigured: isSupabaseConfigured(),
  });

  return <HomeScreen weeklies={weeklies} dailies={dailies} mergedTasks={mergedTasks} />;
}
