import { Badge } from '@/components/ui/Badge';
import { addDaysISO, isoWeekday, shortDayLabel } from '@/lib/calendar';
import { statusTone } from '@/lib/report-utils';
import type { Report } from '@/lib/types';
import { reportsOverlappingRange } from '@/lib/view-utils';
import styles from './WeekGrid.module.css';

export interface WeekGridProps {
  /** Monday of the displayed week. */
  weekStart: string;
  reports: Report[];
  today: string;
  onViewReport: (id: string) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * This Week: a single Mon–Sun, 7-column row. Weekly reports overlapping
 * this week render as a bar spanning `weekStart→weekEnd`, clipped to this
 * week's 7 columns (`Math.max`/`Math.min` via ISO `localeCompare`, same
 * convention as `reportsOverlappingRange`). Bars feed a single 7-col grid
 * via `.barRow { display: contents }` + CSS auto-placement, so day-disjoint
 * bars may share a visual row (column-packed) while overlapping ones flow to
 * new rows -- there's no lane cap/overflow here, unlike `MonthGrid`, since a
 * single week has plenty of vertical room. (Phase 4 note: sub-week daily
 * chips will column-pack into shared rows too -- force `grid-row` if that's
 * not the desired stacking.)
 */
export function WeekGrid({ weekStart, reports, today, onViewReport }: WeekGridProps) {
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
    </div>
  );
}
