'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { fmtDateShort, nowDate } from '@/lib/format';
import { taskTone } from '@/lib/report-utils';
import { BUCKET_GROUPS, BUCKET_LABELS, BUCKET_ORDER, buildTaskSchedule, groupScheduleByBucket } from '@/lib/task-schedule';
import type { ScheduleBucket } from '@/lib/task-schedule';
import type { Report } from '@/lib/types';
import styles from './TaskScheduleView.module.css';

export interface TaskScheduleViewProps {
  reports: Report[];
  /**
   * `?filter=<bucket>` from the URL, already validated by the caller
   * (`TaskViewScreen`'s `isScheduleBucket`) -- the bucket a dashboard/report
   * stat card link should land pre-selected on. `null` for an organic tab
   * visit, in which case the initializer below picks the first bucket (in
   * `BUCKET_ORDER`) that actually has tasks in it, so the view never lands
   * on a table the user has to immediately click away from. Read ONCE, on
   * mount, exactly like `TaskDialog`'s "resets on open, not on every
   * render" precedent -- a later tile click is this view's own business,
   * not something that needs to keep re-syncing from the URL.
   */
  initialFilter: ScheduleBucket | null;
}

const COLUMNS: TableColumn[] = [
  { key: 'client', label: 'Client' },
  { key: 'task', label: 'Task' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'status', label: 'Current Status' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * Tile accent, using ONLY the semantic tokens already in the system (no new
 * colour tokens -- CLAUDE.md's binding constraints): `--action-danger` for
 * the two overdue buckets (the same token `Button`'s `danger` variant and
 * the report-delete controls use for "this needs attention"), `--positive`/
 * `--warning` for the completed buckets that already have a Badge tone
 * carrying that exact meaning (`taskTone` never returns a distinct tone for
 * "late" vs "on time" -- both show as the SAME `Complete` badge -- so the
 * tile is what actually carries that distinction here). `on-track`,
 * `completed-timing-unclear`, and `no-deadline` deliberately get the same
 * muted, no-particular-urgency treatment: none of the three is a problem
 * calling for attention the way overdue/late are.
 */
function toneClass(bucket: ScheduleBucket): string {
  if (bucket === 'overdue-blocked' || bucket === 'overdue-unresolved') return styles.toneDanger;
  if (bucket === 'completed-on-time') return styles.tonePositive;
  if (bucket === 'completed-late' || bucket === 'completed-late-after-block') return styles.toneWarning;
  return styles.toneMuted;
}

/**
 * Empty-state copy MUST teach, not just say "nothing here" (CLAUDE.md) --
 * every branch below explains what would have to be true for a task to
 * land in that bucket, so an empty completed-* bucket reads as "here's how
 * this works" rather than a dead end.
 */
function emptyStateCopy(bucket: ScheduleBucket): string {
  switch (bucket) {
    case 'no-deadline':
      return 'Every tracked task currently carries at least one recorded deadline -- none is missing one right now.';
    case 'on-track':
      return "No open task has a future deadline right now. Every open task either has no deadline recorded, or its deadline has already passed (see the other tiles).";
    case 'overdue-blocked':
      return 'No open task is both overdue and currently marked Blocked.';
    case 'overdue-unresolved':
      return "No open task is overdue without also being marked Blocked.";
    case 'completed-on-time':
      return "Nothing has landed here yet. Completion timing is inferred from the week a task is first reported Complete -- once a task's first-Complete report ends on or before its deadline, it will show up in this bucket.";
    case 'completed-late-after-block':
      return 'Nothing has landed here yet. This bucket needs a task that was reported Blocked at some point, then later reported Complete in a reporting period that started after its deadline had already passed.';
    case 'completed-late':
      return 'Nothing has landed here yet. This bucket needs a task first reported Complete in a reporting period that started after its deadline -- without ever being reported Blocked beforehand.';
    case 'completed-timing-unclear':
      return "Nothing has landed here yet. This bucket is for a task whose deadline falls inside the SAME week it was first reported complete -- weekly reporting genuinely can't tell whether it landed before or after that day, so this view says so instead of guessing.";
    default:
      return 'No tasks in this bucket.';
  }
}

/**
 * `/tasks?view=schedule` -- classifies every logical task (across every
 * weekly report) by whether it was delivered on time, and why not, using
 * `lib/task-schedule.ts`'s pure inference. A row of tiles (grouped Open /
 * Completed / No Deadline) doubles as the bucket filter for the table
 * below it. See `lib/task-schedule.ts`'s own header comment for the full
 * "why" -- this component is deliberately thin: it owns only which bucket
 * is selected, everything else is computed by that module.
 */
export function TaskScheduleView({ reports, initialFilter }: TaskScheduleViewProps) {
  // "Today" is read once, on mount -- same precedent as CalendarScreen's own
  // `useState(() => nowDate())` (CLAUDE.md "Task and Calendar views"). Safe
  // here for the same reason: this component never renders on a page that
  // could be the very first paint (TaskViewScreen already gates on
  // `reports !== null`).
  const [today] = useState(() => nowDate());
  const scheduled = useMemo(() => buildTaskSchedule(reports, today), [reports, today]);
  const grouped = useMemo(() => groupScheduleByBucket(scheduled), [scheduled]);

  const [selectedBucket, setSelectedBucket] = useState<ScheduleBucket>(
    () => initialFilter ?? BUCKET_ORDER.find((bucket) => grouped[bucket].length > 0) ?? 'on-track'
  );

  const rows = grouped[selectedBucket];

  return (
    <div>
      <p className={styles.explainer}>
        Completion timing below is <strong>inferred from report history</strong>, not stored directly -- a
        task&rsquo;s status is read off every weekly report it appears in, matched by client + task text. Two honest
        caveats:
        weekly reporting resolves to a <strong>week, not a day</strong>, so a task first reported complete in the
        same week as its deadline lands in &ldquo;Timing Unclear&rdquo; rather than a guessed on-time/late call; and
        a task is tracked across reports by its <strong>client + task text</strong>, so renaming a task&rsquo;s title
        starts a new tracking chain.
      </p>

      {BUCKET_GROUPS.map((group) => (
        <div key={group.heading} className={styles.tileGroup}>
          <div className={styles.tileGroupHeading}>{group.heading}</div>
          <div className={styles.tiles}>
            {group.buckets.map((bucket) => (
              <button
                key={bucket}
                type="button"
                className={`${styles.tile} ${toneClass(bucket)} ${selectedBucket === bucket ? styles.tileSelected : ''}`}
                aria-pressed={selectedBucket === bucket}
                onClick={() => setSelectedBucket(bucket)}
              >
                <span className={styles.tileLabel}>{BUCKET_LABELS[bucket]}</span>
                <span className={styles.tileValue}>{grouped[bucket].length}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className={styles.panel}>
        {rows.length === 0 ? (
          <div className={styles.emptyState}>{emptyStateCopy(selectedBucket)}</div>
        ) : (
          <Table
            stacked
            columns={COLUMNS}
            rows={rows.map((s) => ({
              client: s.client,
              task: s.task,
              deadline: fmtDateShort(s.deadline),
              status: <Badge tone={taskTone(s.currentStatus)}>{s.currentStatus}</Badge>,
              evidence: <span className={styles.evidenceText}>{s.evidence}</span>,
              actions: (
                <Link href={`/reports/${s.latestReport.id}`} className={styles.rowAction}>
                  View Report
                </Link>
              ),
            }))}
          />
        )}
      </div>
    </div>
  );
}
