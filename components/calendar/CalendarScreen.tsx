'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { addMonthsISO, addWeeksISO, endOfWeekISO, firstOfMonthISO, monthGridDays, monthLabel, startOfWeekISO } from '@/lib/calendar';
import { fmtWeekLabel, nowDate } from '@/lib/format';
import { useAssignedTasks } from '@/lib/hooks/useAssignedTasks';
import { useProjects } from '@/lib/hooks/useProjects';
import { useSession } from '@/lib/hooks/useSession';
import { useTeamMembers } from '@/lib/hooks/useTeamMembers';
import { projectIdForClientName } from '@/lib/projects';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { TASK_LENS_OPTIONS, tasksByDay } from '@/lib/task-calendar';
import type { TaskLens } from '@/lib/task-calendar';
import { mergeTaskSources } from '@/lib/task-merge';
import { assigneeSelectOptions, UNASSIGNED_VALUE } from '@/lib/team';
import type { DailyReport, Report } from '@/lib/types';
import { MonthGrid } from './MonthGrid';
import { WeekGrid } from './WeekGrid';
import styles from './CalendarScreen.module.css';

export interface CalendarScreenProps {
  reports: Report[];
  /** WP5 (calendar task lens): dailies feed ONLY the new task-chip layer -- report bars stay weekly-only, unchanged (CLAUDE.md "Task and Calendar views (Phase 3)"'s own documented scope for report bars specifically). A task lens showing "everything you're on the hook for" would be a silent, misleading gap without dailies -- unlike report bars (a deliberate, narrower "weekly cadence" view), a personal task list has no good reason to hide a daily report's tasks. */
  dailies: DailyReport[];
}

type CalendarMode = 'week' | 'month';

/** Distinct from `lib/team.ts`'s `UNASSIGNED_VALUE` -- this sentinel means "no member filter applied at all" (every task, assigned or not), not "assigned to nobody." */
const MEMBER_FILTER_ALL = '__calendar_all_members__';

/**
 * `/calendar` -- owns its own (small) mode/nav state directly, same
 * rationale as `TaskViewScreen`/`ReportScreen`: no filters, one
 * `useReports()` call already made by the thin page wrapper. Week and
 * month anchors are tracked independently (`weekStart` always Monday-
 * anchored, `monthStart` always 1st-of-month-anchored) so switching tabs
 * never loses your place in the other view.
 *
 * WP5 (calendar task lens): also calls `useAssignedTasks()`/`useSession()`/
 * `useProjects()`/`useTeamMembers()` directly (same "no separate route-
 * level orchestrator needed" precedent `TaskViewScreen` already
 * established for its own extra hooks) to build the ONE shared
 * `mergeTaskSources` set (lib/task-merge.ts) from `reports` + `dailies` +
 * the viewer's assigned-elsewhere tasks, then narrows it by a lens
 * (deadline/created/completed, `lib/task-calendar.ts`), an optional
 * project filter (reusing the dashboard's id-or-exact-name predicate via
 * `projectIdForClientName` -- see `DashboardScreen.tsx`'s identical
 * `filterProjectId` comment for why matching on EITHER `client` OR
 * `projectId` matters post-rename), and an optional team-member filter
 * (`assigneeSelectOptions` + an extra "All Team Members" sentinel,
 * distinct from that helper's own "Unassigned" one). `WeekGrid`/`MonthGrid`
 * render the result as status-toned chips; **report bars are completely
 * untouched** -- they still derive only from `reports`/
 * `reportsOverlappingRange`, exactly as before this package.
 */
export function CalendarScreen({ reports, dailies }: CalendarScreenProps) {
  const router = useRouter();
  const [today] = useState(() => nowDate());
  const [mode, setMode] = useState<CalendarMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(today));
  const [monthStart, setMonthStart] = useState(() => firstOfMonthISO(today));

  const [lens, setLens] = useState<TaskLens>('deadline');
  const [filterProjectName, setFilterProjectName] = useState('All');
  const [filterMember, setFilterMember] = useState(MEMBER_FILTER_ALL);

  const { projects } = useProjects();
  const { members: teamMembers } = useTeamMembers();
  const { tasks: assignedTasks } = useAssignedTasks();
  const { user, loading: sessionLoading } = useSession();

  const mergedTasks = useMemo(
    () =>
      mergeTaskSources([...reports, ...dailies], assignedTasks ?? [], {
        user,
        loading: sessionLoading,
        supabaseConfigured: isSupabaseConfigured(),
      }),
    [reports, dailies, assignedTasks, user, sessionLoading]
  );

  // Same id-or-exact-name membership `DashboardScreen.tsx`'s own
  // `filtered` useMemo uses -- a task matches the selected project by its
  // CURRENT name (the common, un-renamed case) OR by `projectId` (catches a
  // pre-rename task whose `client` string still says the OLD name). Exact
  // matches only, no fuzzy matching, mirroring `projectIdForClientName`'s
  // own contract.
  const filteredTaskEntries = useMemo(() => {
    const filterProjectId = filterProjectName === 'All' ? undefined : projectIdForClientName(filterProjectName, projects ?? []);
    return mergedTasks.filter((entry) => {
      if (filterProjectName !== 'All') {
        const matchesProject =
          entry.task.client === filterProjectName || (filterProjectId !== undefined && entry.task.projectId === filterProjectId);
        if (!matchesProject) return false;
      }
      if (filterMember !== MEMBER_FILTER_ALL) {
        if (filterMember === UNASSIGNED_VALUE) {
          if (entry.task.assigneeId) return false;
        } else if (entry.task.assigneeId !== filterMember) {
          return false;
        }
      }
      return true;
    });
  }, [mergedTasks, filterProjectName, filterMember, projects]);

  // The displayed range depends on which mode is active -- Week's is a
  // plain Mon-Sun span; Month's covers the FULL 42-cell grid (including the
  // padding days from the adjacent months `MonthGrid` also displays), so a
  // task dated into a padding day still shows up where it's actually drawn.
  const monthDays = monthGridDays(monthStart);
  const rangeStart = mode === 'week' ? weekStart : monthDays[0];
  const rangeEnd = mode === 'week' ? endOfWeekISO(weekStart) : monthDays[monthDays.length - 1];

  const tasksByDayISO = useMemo(
    () => tasksByDay(filteredTaskEntries, rangeStart, rangeEnd, lens),
    [filteredTaskEntries, rangeStart, rangeEnd, lens]
  );

  const handleViewReport = (id: string) => router.push(`/reports/${id}`);
  const handleOpenTask = (reportId: string, kind: 'weekly' | 'daily') =>
    router.push(kind === 'weekly' ? `/reports/${reportId}` : `/daily/${reportId}`);

  const handlePrev = () => {
    if (mode === 'week') setWeekStart((v) => addWeeksISO(v, -1));
    else setMonthStart((v) => addMonthsISO(v, -1));
  };
  const handleNext = () => {
    if (mode === 'week') setWeekStart((v) => addWeeksISO(v, 1));
    else setMonthStart((v) => addMonthsISO(v, 1));
  };
  const handleToday = () => {
    setWeekStart(startOfWeekISO(today));
    setMonthStart(firstOfMonthISO(today));
  };

  const rangeLabel = mode === 'week' ? fmtWeekLabel(weekStart, endOfWeekISO(weekStart)) : monthLabel(monthStart);

  const projectOptions = ['All', ...(projects ?? []).map((p) => p.name)];
  const memberOptions = [{ value: MEMBER_FILTER_ALL, label: 'All Team Members' }, ...assigneeSelectOptions(teamMembers ?? [])];

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.wordmark}>Calendar</span>
      </div>

      <div className={styles.content}>
        <div className={styles.toolbar}>
          <div className={styles.rangeLabel}>{rangeLabel}</div>
          <div className={styles.nav}>
            <Button variant="outline" size="sm" onClick={handlePrev}>
              &larr; Prev
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={handleNext}>
              Next &rarr;
            </Button>
          </div>
        </div>

        {/* WP5: the task-lens toolbar -- narrows which tasks the chips below
            show, and by which date. Independent of the report-bar-driven
            Week/Month toggle below; changing these never affects report
            bars at all. */}
        <div className={styles.taskFilters}>
          <Select
            label="Task Dates"
            options={TASK_LENS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={lens}
            onChange={(value) => setLens(value as TaskLens)}
          />
          <Select label="Project" options={projectOptions} value={filterProjectName} onChange={setFilterProjectName} />
          <Select label="Team Member" options={memberOptions} value={filterMember} onChange={setFilterMember} />
        </div>

        <div className={styles.tabsRow}>
          <Tabs
            aria-label="Calendar range"
            value={mode}
            onChange={(value) => setMode(value as CalendarMode)}
            items={[
              {
                value: 'week',
                label: 'This Week',
                content: (
                  <div className={styles.panel}>
                    <WeekGrid
                      weekStart={weekStart}
                      reports={reports}
                      today={today}
                      onViewReport={handleViewReport}
                      tasksByDayISO={tasksByDayISO}
                      onOpenTask={handleOpenTask}
                    />
                  </div>
                ),
              },
              {
                value: 'month',
                label: 'This Month',
                content: (
                  <div className={styles.panel}>
                    <MonthGrid
                      monthStart={monthStart}
                      reports={reports}
                      today={today}
                      onViewReport={handleViewReport}
                      tasksByDayISO={tasksByDayISO}
                      onOpenTask={handleOpenTask}
                    />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
