import { Suspense } from 'react';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

/**
 * `/settings` -- follows the `ReportScreen`/`TaskViewScreen`/`CalendarScreen`
 * precedent: no repository state, no pagination, so no separate route-level
 * orchestrator. `SettingsScreen` owns its own (small) tab/theme/copy state.
 * The `<Suspense>` boundary is required because `SettingsScreen` reads
 * `useSearchParams()` for `?tab=` deep-linking (nav IA restructure).
 */
export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
