import { Badge } from '@/components/ui/Badge';
import { Popover } from '@/components/ui/Popover';
import { isSameMonth, isoWeekday, monthGridDays } from '@/lib/calendar';
import { parseISO } from '@/lib/format';
import { statusTone } from '@/lib/report-utils';
import type { Report } from '@/lib/types';
import { reportsOverlappingRange } from '@/lib/view-utils';
import styles from './MonthGrid.module.css';

export interface MonthGridProps {
  /** First-of-month anchor for the displayed month. */
  monthStart: string;
  reports: Report[];
  today: string;
  onViewReport: (id: string) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Report bars stacked per week-row before the rest collapse into a "+N more" popover -- keeps every row a uniform height regardless of report count. */
const MAX_VISIBLE_LANES = 2;

interface LaneBar {
  report: Report;
  colStart: number;
  colEnd: number;
  lane: number;
}

/**
 * Greedy interval-lane packing for one week-row: reports are sorted by
 * start date, then each one reuses the first lane whose last-placed bar
 * ends before this bar's start column, or opens a new lane. A Mon–Fri seed
 * week always produces exactly one bar per row (`colStart`/`colEnd` clipped
 * to this row's Mon–Sun span via ISO `localeCompare`), but this still packs
 * correctly if two reports' weeks ever genuinely overlap.
 */
function packLanes(rowStart: string, rowEnd: string, reports: Report[]): LaneBar[] {
  const sorted = reports
    .slice()
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.weekEnd.localeCompare(b.weekEnd));
  const laneEnds: number[] = [];
  const bars: LaneBar[] = [];
  for (const report of sorted) {
    const clippedStart = report.weekStart.localeCompare(rowStart) > 0 ? report.weekStart : rowStart;
    const clippedEnd = report.weekEnd.localeCompare(rowEnd) < 0 ? report.weekEnd : rowEnd;
    const colStart = isoWeekday(clippedStart);
    const colEnd = isoWeekday(clippedEnd);
    let lane = laneEnds.findIndex((end) => end < colStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(colEnd);
    } else {
      laneEnds[lane] = colEnd;
    }
    bars.push({ report, colStart, colEnd, lane });
  }
  return bars;
}

/**
 * This Month: Monday-start, 6-row (42-cell) grid (`monthGridDays`). Each
 * row is one Mon–Sun calendar week, so a Mon–Fri seed report always sits
 * inside a single row by construction. Reports beyond `MAX_VISIBLE_LANES`
 * in a row collapse into a "+N more" `Popover` trigger.
 */
export function MonthGrid({ monthStart, reports, today, onViewReport }: MonthGridProps) {
  const gridDays = monthGridDays(monthStart);
  const rows = Array.from({ length: 6 }, (_, r) => gridDays.slice(r * 7, r * 7 + 7));

  return (
    <div className={styles.month}>
      <div className={styles.dayLabels}>
        {DAY_LABELS.map((label) => (
          <div key={label} className={styles.dayLabelCell}>
            {label}
          </div>
        ))}
      </div>

      {rows.map((row) => {
        const rowStart = row[0];
        const rowEnd = row[6];
        const overlapping = reportsOverlappingRange(reports, rowStart, rowEnd);
        const bars = packLanes(rowStart, rowEnd, overlapping);
        const visibleBars = bars.filter((b) => b.lane < MAX_VISIBLE_LANES);
        const overflowBars = bars.filter((b) => b.lane >= MAX_VISIBLE_LANES);

        return (
          <div key={rowStart} className={styles.week}>
            <div className={styles.dayNumbers}>
              {row.map((day) => (
                <div
                  key={day}
                  className={[
                    styles.dayCell,
                    isSameMonth(day, monthStart) ? '' : styles.outsideMonth,
                    day === today ? styles.today : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {parseISO(day).d}
                </div>
              ))}
            </div>

            <div className={styles.barLanes}>
              {visibleBars.map(({ report, colStart, colEnd, lane }) => (
                <button
                  key={report.id}
                  type="button"
                  className={styles.bar}
                  style={{ gridColumn: `${colStart} / ${colEnd + 1}`, gridRow: lane + 1 }}
                  onClick={() => onViewReport(report.id)}
                  title={report.preparedFor}
                >
                  {report.preparedFor}
                </button>
              ))}

              {overflowBars.length > 0 ? (
                <div className={styles.overflow} style={{ gridColumn: '1 / 2', gridRow: MAX_VISIBLE_LANES + 1 }}>
                  <Popover
                    trigger={
                      <button type="button" className={styles.overflowTrigger}>
                        +{overflowBars.length} more
                      </button>
                    }
                  >
                    <div className={styles.overflowList}>
                      {overflowBars.map(({ report }) => (
                        <button
                          key={report.id}
                          type="button"
                          className={styles.overflowItem}
                          onClick={() => onViewReport(report.id)}
                        >
                          <span>{report.preparedFor}</span>
                          <Badge tone={statusTone(report.status)}>{report.status}</Badge>
                        </button>
                      ))}
                    </div>
                  </Popover>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
