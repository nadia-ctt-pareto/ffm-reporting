import { Badge } from '@/components/ui/Badge';
import { Popover } from '@/components/ui/Popover';
import { addDaysISO, isoWeekday, shortDayLabel } from '@/lib/calendar';
import { statusTone } from '@/lib/report-utils';
import type { MergedTaskEntry } from '@/lib/task-merge';
import type { Report } from '@/lib/types';
import { reportsOverlappingRange } from '@/lib/view-utils';
import { TaskChip } from './TaskChip';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  /** Monday of the displayed week. */
  weekStart: string;
  reports: Report[];
  today: string;
  onViewReport: (id: string) => void;
  /**
   * WP5 (calendar task lens): every day in the displayed week, keyed by ISO
   * date, already filtered/grouped by the active lens/project/member
   * filters (`CalendarScreen`'s `lib/task-calendar.ts` call) -- a day
   * absent from this map (or mapped to `[]`) simply renders no chips, same
   * "honest-empty, never invent a placement" posture `lib/task-calendar.ts`
   * itself documents.
   */
  tasksByDayISO: Record<string, MergedTaskEntry[]>;
  /** Navigates to `/reports/[id]` or `/daily/[id]` for a task chip -- only ever called for a chip whose `source.canOpen` is true (see `TaskChip.tsx`). */
  onOpenTask: (reportId: string, kind: 'weekly' | 'daily') => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Caps a day's VISIBLE task chips before the rest collapse into a "+N more" popover -- a week has plenty of horizontal room for report bars (no cap there), but a single day cell is narrow, so tasks get their own, smaller cap. */
const MAX_VISIBLE_DAY_CHIPS = 4;

/**
 * This Week: a single Mon–Sun, 7-column row. Weekly reports overlapping
 * this week render as a bar spanning `weekStart→weekEnd`, clipped to this
 * week's 7 columns (`Math.max`/`Math.min` via ISO `localeCompare`, same
 * convention as `reportsOverlappingRange`). Bars feed a single 7-col grid
 * via `.barRow { display: contents }` + CSS auto-placement, so day-disjoint
 * bars may share a visual row (column-packed) while overlapping ones flow to
 * new rows -- there's no lane cap/overflow here, unlike `MonthGrid`, since a
 * single week has plenty of vertical room.
 *
 * WP5 (calendar task lens): a SEPARATE 7-column row of task chips renders
 * below the report bars -- report bars themselves are completely untouched
 * (still driven only by `reports`/`reportsOverlappingRange`, weekly-only,
 * see CLAUDE.md "Task and Calendar views (Phase 3)"). Each day cell shows up
 * to `MAX_VISIBLE_DAY_CHIPS` chips, with the rest behind a "+N more"
 * `Popover` -- the exact idiom `MonthGrid`'s report-bar overflow already
 * established, reused here for tasks.
 */
export function WeekGrid({ weekStart, reports, today, onViewReport, tasksByDayISO, onOpenTask }: WeekGridProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const weekEnd = days[6];

  const overlapping = reportsOverlappingRange(reports, weekStart, weekEnd)
    .slice()
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return (
    <div className={styles.week}>
      <div className={styles.dayHeaders}>
        {days.map((day, i) => (
          <div key={day} className={`${styles.dayHeader} ${day === today ? styles.today : ''}`}>
            <span className={styles.dayLabel}>{DAY_LABELS[i]}</span>
            <span className={styles.dayDate}>{shortDayLabel(day)}</span>
          </div>
        ))}
      </div>

      <div className={styles.bars}>
        {overlapping.length === 0 ? (
          <div className={styles.emptyState}>No reports overlap this week.</div>
        ) : (
          overlapping.map((report) => {
            const barStart = report.weekStart.localeCompare(weekStart) > 0 ? report.weekStart : weekStart;
            const barEnd = report.weekEnd.localeCompare(weekEnd) < 0 ? report.weekEnd : weekEnd;
            const colStart = isoWeekday(barStart);
            const colEnd = isoWeekday(barEnd);
            return (
              <div key={report.id} className={styles.barRow}>
                <button
                  type="button"
                  className={styles.bar}
                  style={{ gridColumn: `${colStart} / ${colEnd + 1}` }}
                  onClick={() => onViewReport(report.id)}
                >
                  <span className={styles.barLabel}>{report.preparedFor}</span>
                  <Badge tone={statusTone(report.status)}>{report.status}</Badge>
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.taskRow}>
        {days.map((day) => {
          const dayEntries = tasksByDayISO[day] ?? [];
          const visible = dayEntries.slice(0, MAX_VISIBLE_DAY_CHIPS);
          const overflow = dayEntries.slice(MAX_VISIBLE_DAY_CHIPS);
          return (
            <div key={day} className={styles.taskCell}>
              {visible.map((entry) => (
                <TaskChip key={`${entry.source.reportId}::${entry.task.id}`} entry={entry} onOpen={onOpenTask} />
              ))}
              {overflow.length > 0 ? (
                <Popover
                  trigger={
                    <button type="button" className={styles.overflowTrigger}>
                      +{overflow.length} more
                    </button>
                  }
                >
                  <div className={styles.overflowList}>
                    {overflow.map((entry) => (
                      <TaskChip key={`${entry.source.reportId}::${entry.task.id}`} entry={entry} onOpen={onOpenTask} />
                    ))}
                  </div>
                </Popover>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
