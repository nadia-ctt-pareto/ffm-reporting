'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { aggregateReportsIntoDraft } from '@/lib/aggregate';
import { addWeeksISO, endOfWeekISO, startOfWeekISO } from '@/lib/calendar';
import { normalizeClientNames, stripEmptyItems, suggestClientNameRenames } from '@/lib/consolidate';
import type { ClientNameSuggestion } from '@/lib/consolidate';
import { fmtWeekLabel, nowDate, uid } from '@/lib/format';
import { blankDraft, reportPeriodLabel, statusTone } from '@/lib/report-utils';
import type { AnyReport, DailyReport, Project, Report, WeeklyReport } from '@/lib/types';
import { reportsOverlappingRange } from '@/lib/view-utils';
import styles from './ConsolidateScreen.module.css';

export interface ConsolidateScreenProps {
  /** Weeklies (Report = WeeklyReport, see lib/types.ts). */
  weeklies: Report[];
  dailies: DailyReport[];
  projects: Project[];
  /** Persists the newly-created consolidated draft (matches `useReports().upsertReport`). Phase 7b: `Promise<void>` -- `handleCreate` below awaits it before navigating (see that function's doc comment). */
  onCreateReport: (report: Report) => Promise<void>;
}

const HOUSE_BUCKET_LABEL = 'Foundation First (this workspace)';

/** `report.projectId ?? null`, flattened to `''` for use as a Map key (mirrors `sameProjectBucket`'s coalesce convention, lib/report-utils.ts). */
function bucketKey(report: AnyReport): string {
  return report.projectId ?? '';
}

function bucketLabel(key: string, projects: Project[]): string {
  if (key === '') return HOUSE_BUCKET_LABEL;
  return projects.find((p) => p.id === key)?.name ?? key;
}

/** `record[key] ?? fallback`, but treats an OWN `false` value as a real (accepted) value rather than falling back -- `??` alone is wrong here because a file/report-controlled key (a report id, a client string) could coincidentally match an inherited `Object.prototype` member name (`constructor`, `toString`, ...), which `??` would treat as "not set" and silently ignore. */
function readFlag(record: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return Object.hasOwn(record, key) ? record[key] : fallback;
}

const SOURCE_COLUMNS: TableColumn[] = [
  // Mobile P3 follow-up: `label: ''` is kept for the desktop `<th>` (a
  // visible "Include" header there would be redundant next to every other
  // column's real header) -- `stackedLabel` supplies a real label for the
  // mobile stacked layout only, so this cell pairs with a label instead of
  // rendering detached (see Table.module.css's `[data-role='actions']` doc
  // comment).
  { key: 'include', label: '', stackedLabel: 'Include' },
  { key: 'period', label: 'Kind & Period' },
  { key: 'status', label: 'Status' },
  { key: 'tasks', label: 'Tasks', align: 'center' },
  { key: 'risks', label: 'Risks', align: 'center' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

const LOG_COLUMNS: TableColumn[] = [
  { key: 'type', label: 'Type' },
  { key: 'key', label: 'Key' },
  { key: 'keptFrom', label: 'Kept From' },
  { key: 'mergedFrom', label: 'Merged From' },
];

/**
 * `/consolidate` -- three stages, top to bottom: (1) pick a Mon-Sun week
 * (same anchor pattern as `CalendarScreen`); (2) every weekly/daily report
 * touching that week, grouped by project bucket, each with an include
 * checkbox (all checked by default); (3) a live merged preview of the
 * checked sources, with sanitization (client-name normalization
 * suggestions, empty-row drops) applied only to the merged OUTPUT --
 * sources themselves are never mutated, never re-persisted, and never
 * deleted, no matter what's checked/unchecked or accepted/declined here.
 * "Create Consolidated Weekly Draft" always CREATES a new `WeeklyReport`
 * (never edits one) and hands off to the familiar wizard
 * (`/reports/[id]/edit`) for any further editing -- flipping statuses or
 * rewording content is explicitly out of scope for this screen. A source's
 * own `summaryNarrative` is never merged in either (the aggregator never
 * touched summaries pre-Phase-6b and still doesn't) -- the consolidated
 * draft starts with a blank summary, written fresh in the wizard.
 *
 * Every derived stage below (`allSources` through `{draft, log}`) is
 * `useMemo`'d: `aggregateReportsIntoDraft` mints fresh ids via `uid()` for
 * every new task/risk/priority, so recomputing it on every render (Fast
 * Refresh, an unrelated parent re-render, React Strict Mode's double-invoke
 * in dev) would burn through that counter and redo real work for nothing.
 */
export function ConsolidateScreen({ weeklies, dailies, projects, onCreateReport }: ConsolidateScreenProps) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(nowDate()));
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [renameAccepted, setRenameAccepted] = useState<Record<string, boolean>>({});
  // BLOCKER 4: `handleCreate` is async and `await`s `onCreateReport`, but was
  // wired as a bare `onClick` with no error state -- on a rejection (Supabase
  // down, an RLS denial) `router.push` simply never ran and nothing else
  // happened, so the primary CTA silently did nothing. See `handleCreate`.
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const weekEnd = endOfWeekISO(weekStart);

  const allSources = useMemo<AnyReport[]>(() => {
    const weeklySources = reportsOverlappingRange(weeklies, weekStart, weekEnd);
    const dailySources = dailies.filter((d) => d.date.localeCompare(weekStart) >= 0 && d.date.localeCompare(weekEnd) <= 0);
    return [...weeklySources, ...dailySources];
  }, [weeklies, dailies, weekStart, weekEnd]);

  const sourcesById = useMemo(() => new Map(allSources.map((s) => [s.id, s])), [allSources]);

  const isChecked = useCallback((id: string) => readFlag(checked, id, true), [checked]);
  const toggleChecked = (id: string) => setChecked((c) => ({ ...c, [id]: !isChecked(id) }));

  const includedSources = useMemo(() => allSources.filter((s) => isChecked(s.id)), [allSources, isChecked]);

  const suggestions: ClientNameSuggestion[] = useMemo(() => suggestClientNameRenames(includedSources, projects), [includedSources, projects]);
  const isRenameAccepted = useCallback((from: string) => readFlag(renameAccepted, from, true), [renameAccepted]);
  const toggleRename = (from: string) => setRenameAccepted((r) => ({ ...r, [from]: !isRenameAccepted(from) }));
  const activeRenames = useMemo(() => suggestions.filter((s) => isRenameAccepted(s.from)), [suggestions, isRenameAccepted]);

  const normalized = useMemo(() => normalizeClientNames(includedSources, projects, activeRenames), [includedSources, projects, activeRenames]);
  const strippedPerSource = useMemo(() => normalized.map((source) => ({ sourceId: source.id, ...stripEmptyItems(source) })), [normalized]);
  const strippedReports = useMemo(() => strippedPerSource.map((s) => s.report), [strippedPerSource]);
  const skippedItems = useMemo(
    () => strippedPerSource.flatMap((s) => s.skipped.map((item) => ({ ...item, sourceId: s.sourceId }))),
    [strippedPerSource]
  );

  const { draft, log } = useMemo(
    () => aggregateReportsIntoDraft(strippedReports, { ...blankDraft(), weekStart, weekEnd }),
    [strippedReports, weekStart, weekEnd]
  );

  const orderedGroups = useMemo(() => {
    const groups = new Map<string, AnyReport[]>();
    for (const source of allSources) {
      const key = bucketKey(source);
      groups.set(key, [...(groups.get(key) ?? []), source]);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return bucketLabel(a, projects).localeCompare(bucketLabel(b, projects));
    });
  }, [allSources, projects]);

  const handlePrev = () => setWeekStart((v) => addWeeksISO(v, -1));
  const handleNext = () => setWeekStart((v) => addWeeksISO(v, 1));
  const handleToday = () => setWeekStart(startOfWeekISO(nowDate()));

  // Phase 7b: awaits `onCreateReport` before navigating -- with a
  // `Promise<void>`-returning `onCreateReport` (see HttpReportsRepository),
  // `router.push`ing immediately raced the write: `/reports/[id]/edit`
  // resolves its `id` against `useReports().reports`, which the wizard's
  // own route wrapper redirects away from `/` on an unrecognized id (see
  // WizardPage's "unknown id" handling) -- a real risk the instant the
  // repository is a network round-trip instead of a synchronous
  // localStorage write.
  //
  // BLOCKER 4 fix: wrapped in try/catch/finally -- a rejection (Supabase
  // down, an RLS denial) now sets `createError` (rendered next to the
  // button below) instead of leaving the primary CTA looking like a dead
  // button with zero feedback; `isCreating` disables it while the write is
  // in flight so a slow round-trip can't be double-clicked into two drafts.
  async function handleCreate() {
    if (includedSources.length === 0 || isCreating) return;
    const id = uid('r');
    const now = nowDate();
    const newReport: WeeklyReport = {
      id,
      kind: 'weekly',
      weekStart,
      weekEnd,
      status: 'Draft',
      preparedFor: draft.preparedFor,
      preparedBy: draft.preparedBy,
      createdAt: now,
      updatedAt: now,
      summaryNarrative: draft.summaryNarrative,
      tasks: draft.tasks,
      risks: draft.risks,
      win: draft.win,
      touchpoints: draft.touchpoints,
      priorities: draft.priorities,
      projectId: undefined,
    };
    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreateReport(newReport);
      router.push(`/reports/${id}/edit`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create the consolidated draft. Please try again.');
      setIsCreating(false);
    }
  }

  return (
    <div>
      <PageHeader title="Consolidate" />

      <div className={styles.content}>
        <div className={styles.toolbar}>
          <div className={styles.rangeLabel}>{fmtWeekLabel(weekStart, weekEnd)}</div>
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

        <section className={styles.section}>
          <div className={styles.sectionKicker}>Sources</div>
          {allSources.length === 0 ? (
            <div className={styles.emptyState}>No weekly or daily reports touch this week.</div>
          ) : (
            orderedGroups.map(([key, sources]) => (
              <div key={key || 'house'} className={styles.sourceGroup}>
                <div className={styles.sourceGroupHeading}>{bucketLabel(key, projects)}</div>
                <Table
                  dense
                  stacked
                  columns={SOURCE_COLUMNS}
                  rows={sources.map((source) => {
                    const sourceLabel = `${source.kind === 'weekly' ? 'Weekly' : 'Daily'} ${reportPeriodLabel(source)}`;
                    return {
                      include: (
                        <Checkbox label={`Include ${sourceLabel}`} checked={isChecked(source.id)} onChange={() => toggleChecked(source.id)} />
                      ),
                      period: sourceLabel,
                      status: <Badge tone={statusTone(source.status)}>{source.status}</Badge>,
                      tasks: String(source.tasks.length),
                      risks: String(source.risks.length),
                      actions: (
                        <Link href={source.kind === 'weekly' ? `/reports/${source.id}` : `/daily/${source.id}`} className={styles.rowAction}>
                          View
                        </Link>
                      ),
                    };
                  })}
                />
              </div>
            ))
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionKicker}>Sanitize</div>

          {suggestions.length > 0 ? (
            <div className={styles.sanitizeBlock}>
              <div className={styles.sanitizeLabel}>Client-name normalization</div>
              <div className={styles.checkList}>
                {suggestions.map((s) => (
                  <Checkbox
                    key={s.from}
                    label={`Rename "${s.from}" → "${s.to}" (merged output only)`}
                    checked={isRenameAccepted(s.from)}
                    onChange={() => toggleRename(s.from)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {skippedItems.length > 0 ? (
            <div className={styles.sanitizeBlock}>
              <div className={styles.sanitizeLabel}>Empty rows skipped</div>
              <p className={styles.sanitizeCopy}>
                {skippedItems.filter((i) => i.type === 'task').length} blank task
                {skippedItems.filter((i) => i.type === 'task').length === 1 ? '' : 's'},{' '}
                {skippedItems.filter((i) => i.type === 'risk').length} blank risk
                {skippedItems.filter((i) => i.type === 'risk').length === 1 ? '' : 's'}, and{' '}
                {skippedItems.filter((i) => i.type === 'priority').length} blank priorit
                {skippedItems.filter((i) => i.type === 'priority').length === 1 ? 'y' : 'ies'} excluded from the merged output.
              </p>
            </div>
          ) : null}

          {suggestions.length === 0 && skippedItems.length === 0 ? (
            <p className={styles.sanitizeCopy}>Nothing to sanitize -- every included source&apos;s client names and rows are already clean.</p>
          ) : null}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionKicker}>Preview</div>
          {includedSources.length === 0 ? (
            <div className={styles.emptyState}>Check at least one source above to build a draft.</div>
          ) : (
            <>
              <div className={styles.statsGrid}>
                <StatCard label="Tasks" value={String(draft.tasks.length)} />
                <StatCard label="Risks" value={String(draft.risks.length)} />
                <StatCard label="Priorities" value={String(draft.priorities.length)} />
                <StatCard label="Touchpoints" value={String(draft.touchpoints.calls + draft.touchpoints.emails + draft.touchpoints.escalations)} />
              </div>

              {log.length > 0 ? (
                <div className={styles.mergeLog}>
                  <div className={styles.sanitizeLabel}>Dedupe disclosure</div>
                  <p className={styles.sanitizeCopy}>
                    &ldquo;Kept From&rdquo; is the LATEST contributing source for tasks/risks, but the FIRST for priorities
                    (identical priority text has no meaningful &ldquo;version&rdquo; to prefer a later one over). Each
                    source&apos;s own summary narrative is not merged -- write a fresh one in the wizard.
                  </p>
                  <Table
                    dense
                    scrollX
                    columns={LOG_COLUMNS}
                    rows={log.map((entry) => ({
                      type: entry.type,
                      key: entry.key,
                      keptFrom: (
                        <>
                          {sourcesById.get(entry.keptFromId) ? reportPeriodLabel(sourcesById.get(entry.keptFromId)!) : entry.keptFromId}
                          {entry.mergedFromIds.length > 1 ? (
                            <>
                              {' '}
                              <Badge tone="sage">Deduped ×{entry.mergedFromIds.length}</Badge>
                            </>
                          ) : null}
                        </>
                      ),
                      mergedFrom: entry.mergedFromIds
                        .map((id) => (sourcesById.get(id) ? reportPeriodLabel(sourcesById.get(id)!) : id))
                        .join(', '),
                    }))}
                  />
                </div>
              ) : null}
            </>
          )}
        </section>

        <div className={styles.createRow}>
          <p className={styles.createCopy}>
            Creates a new Draft weekly report -- sources above are never edited or deleted. You&apos;ll finish editing in the
            familiar wizard.
          </p>
          {createError ? (
            // NIT fix (post-review round 2): `role="alert"`, not
            // `role="status"` -- see TaskViewScreen.tsx's identical fix for
            // the rationale.
            <p className={styles.createError} role="alert">
              {createError}
            </p>
          ) : null}
          <Button variant="primary" size="md" onClick={handleCreate} disabled={includedSources.length === 0 || isCreating}>
            {isCreating ? 'Creating…' : 'Create Consolidated Weekly Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
