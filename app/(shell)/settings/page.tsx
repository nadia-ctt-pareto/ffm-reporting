import { SettingsScreen } from '@/components/settings/SettingsScreen';

/**
 * `/settings` -- follows the `ReportScreen`/`TaskViewScreen`/`CalendarScreen`
 * precedent: no repository state, no pagination, so no separate route-level
 * orchestrator. `SettingsScreen` owns its own (small) theme-picker/copy
 * state directly, the same way those screens own their own dialog/mode
 * state.
 */
export default function SettingsPage() {
  return <SettingsScreen />;
}
