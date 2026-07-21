import { DashboardPage } from '@/components/dashboard/DashboardPage';

// Nav IA restructure: the weekly-reports list, moved off `/` (now the Home
// overview) to its own `/reports` route -- reached via the sidebar's
// "Reports > Weekly" nav item. Renders the unchanged DashboardPage orchestrator.
export default function Page() {
  return <DashboardPage />;
}
