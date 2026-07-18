'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { addMonthsISO, addWeeksISO, endOfWeekISO, firstOfMonthISO, monthLabel, startOfWeekISO } from '@/lib/calendar';
import { fmtWeekLabel, nowDate } from '@/lib/format';
import type { Report } from '@/lib/types';
import { MonthGrid } from './MonthGrid';
import { WeekGrid } from './WeekGrid';
import styles from './CalendarScreen.module.css';

export interface CalendarScreenProps {
  reports: Report[];
}

type CalendarMode = 'week' | 'month';

/**
 * `/calendar` -- owns its own (small) mode/nav state directly, same
 * rationale as `TaskViewScreen`/`ReportScreen`: no filters, one
 * `useReports()` call already made by the thin page wrapper. Week and
 * month anchors are tracked independently (`weekStart` always Monday-
 * anchored, `monthStart` always 1st-of-month-anchored) so switching tabs
 * never loses your place in the other view.
 */
export function CalendarScreen({ reports }: CalendarScreenProps) {
  const router = useRouter();
  const [today] = useState(() => nowDate());
  const [mode, setMode] = useState<CalendarMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(today));
  const [monthStart, setMonthStart] = useState(() => firstOfMonthISO(today));

  const handleViewReport = (id: string) => router.push(`/reports/${id}`);

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
                    <WeekGrid weekStart={weekStart} reports={reports} today={today} onViewReport={handleViewReport} />
                  </div>
                ),
              },
              {
                value: 'month',
                label: 'This Month',
                content: (
                  <div className={styles.panel}>
                    <MonthGrid monthStart={monthStart} reports={reports} today={today} onViewReport={handleViewReport} />
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
