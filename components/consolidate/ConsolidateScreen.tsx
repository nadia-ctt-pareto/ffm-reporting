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
import { WizardStepper } from '@/components/wizard/WizardStepper';
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

const HOUSE_BUCKET_LABEL = 'Your workspace';

const CONSOLIDATE_STEPS = ['Week', 'Reports', 'Review', 'Create'];

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
  { key: 'key', label: 'Item' },
  { key: 'keptFrom', label: 'Kept version from' },
  { key: 'mergedFrom', label: 'Combined from' },
];

/**
 * `/consolidate` -- a 4-step guided wizard (nav IA restructure; the merge logic
 * itself is untouched -- see `lib/aggregate`/`lib/consolidate`): (1) pick a
 * Mon-Sun week (same anchor pattern as `CalendarScreen`); (2) choose which of
 * the reports touching that week to include, grouped by project bucket --
 * workspace/house sources default CHECKED, project sources default UNCHECKED
 * (the output is always a house `WeeklyReport`, so folding another project's
 * work in is an explicit opt-in; see `isChecked`); (3) review the merged
 * preview + a couple of automatic clean-ups (client-name normalization, empty-
 * row drops) applied only to the OUTPUT -- sources are never mutated, re-
 * persisted, or deleted; (4) create the draft. "Create draft" always CREATES a
 * new `WeeklyReport` (never edits one) and hands off to `/reports/[id]/edit`.
 * A source's own `summaryNarrative` is never merged -- the draft starts blank.
 *
 * Every derived stage (`allSources` through `{draft, log}`) is `useMemo`'d:
 * `aggregateReportsIntoDraft` mints fresh ids via `uid()`, so recomputing it
 * every render would burn that counter and redo real work for nothing.
 */
export function ConsolidateScreen({ weeklies, dailies, projects, onCreateReport }: ConsolidateScreenProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
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

  // Phase 7b (M4): bucket opt-in default -- house sources (`bucketKey === ''`)
  // default CHECKED, project-bucket sources default UNCHECKED. The output is
  // always a house `WeeklyReport` (see `handleCreate` below), so silently
  // pulling in another project's tasks/risks by default was the wrong
  // default; a user who genuinely wants a cross-bucket rollup still can, by
  // explicitly checking those rows. `readFlag` still wins once the user has
  // actually clicked a checkbox for this id -- this only changes the FALLBACK
  // when `checked` has no entry for it yet.
  const isChecked = useCallback(
    (id: string) => {
      const source = sourcesById.get(id);
      const defaultChecked = source ? bucketKey(source) === '' : true;
      return readFlag(checked, id, defaultChecked);
    },
    [checked, sourcesById]
  );
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

  const touchTotal = draft.touchpoints.calls + draft.touchpoints.emails + draft.touchpoints.escalations;

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

  const blankTasks = skippedItems.filter((i) => i.type === 'task').length;
  const blankRisks = skippedItems.filter((i) => i.type === 'risk').length;
  const blankPriorities = skippedItems.filter((i) => i.type === 'priority').length;

  // Phase 7b: awaits `onCreateReport` before navigating -- with a
  // `Promise<void>`-returning `onCreateReport` (see HttpReportsRepository),
  // `router.push`ing immediately raced the write. BLOCKER 4 fix: wrapped in
  // try/catch/finally -- a rejection now sets `createError` (rendered next to
  // the button) instead of leaving the primary CTA looking like a dead button;
  // `isCreating` disables it while the write is in flight so a slow round-trip
  // can't be double-clicked into two drafts.
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

  const weekLabel = fmtWeekLabel(weekStart, weekEnd);
  const nothingChecked = includedSources.length === 0;

  return (
    <div>
      <PageHeader title="Consolidate" />

      <WizardStepper step={step} onStepClick={setStep} labels={CONSOLIDATE_STEPS} />

      <div className={styles.content}>
        {step === 1 ? (
          <section className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Pick a week</h2>
            <p className={styles.stepIntro}>
              Consolidate rolls up all of a week&apos;s weekly and daily reports into one new, editable draft. Nothing you pick
              is changed or deleted -- you&apos;ll get a fresh draft to finish in the wizard.
            </p>
            <div className={styles.toolbar}>
              <div className={styles.rangeLabel}>{weekLabel}</div>
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
            <p className={styles.sanitizeCopy}>
              {allSources.length === 0
                ? 'No weekly or daily reports touch this week yet. Use Prev / Next to find a week with reports.'
                : `${allSources.length} report${allSources.length === 1 ? '' : 's'} found this week.`}
            </p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Choose reports to include</h2>
            <p className={styles.stepIntro}>
              These are the reports touching {weekLabel}. Your workspace&apos;s reports are checked by default; check a
              project&apos;s reports to fold their work into the draft too.
            </p>
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
        ) : null}

        {step === 3 ? (
          <section className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Review &amp; clean up</h2>
            {nothingChecked ? (
              <div className={styles.emptyState}>Go back and check at least one report to build a draft.</div>
            ) : (
              <>
                <p className={styles.stepIntro}>Here&apos;s what the merged draft for {weekLabel} will contain.</p>

                <div className={styles.statsGrid}>
                  <StatCard label="Tasks" value={String(draft.tasks.length)} />
                  <StatCard label="Risks" value={String(draft.risks.length)} />
                  <StatCard label="Priorities" value={String(draft.priorities.length)} />
                  <StatCard label="Touchpoints" value={String(touchTotal)} />
                </div>

                {suggestions.length > 0 ? (
                  <div className={styles.sanitizeBlock}>
                    <div className={styles.sanitizeLabel}>Client name clean-up</div>
                    <p className={styles.sanitizeCopy}>
                      These client names match a project but aren&apos;t written exactly the same. Fixes apply to the merged
                      draft only -- your original reports are untouched.
                    </p>
                    <div className={styles.checkList}>
                      {suggestions.map((s) => (
                        <Checkbox
                          key={s.from}
                          label={`Rename "${s.from}" to "${s.to}"`}
                          checked={isRenameAccepted(s.from)}
                          onChange={() => toggleRename(s.from)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {skippedItems.length > 0 ? (
                  <div className={styles.sanitizeBlock}>
                    <div className={styles.sanitizeLabel}>Empty rows removed</div>
                    <p className={styles.sanitizeCopy}>
                      {blankTasks} blank task{blankTasks === 1 ? '' : 's'}, {blankRisks} blank risk{blankRisks === 1 ? '' : 's'}, and{' '}
                      {blankPriorities} blank priorit{blankPriorities === 1 ? 'y' : 'ies'} were left out of the draft.
                    </p>
                  </div>
                ) : null}

                {suggestions.length === 0 && skippedItems.length === 0 ? (
                  <p className={styles.sanitizeCopy}>Everything looks clean -- no name fixes or empty rows to remove.</p>
                ) : null}

                {log.length > 0 ? (
                  <details className={styles.mergeDetails}>
                    <summary className={styles.mergeSummary}>How duplicates were merged ({log.length})</summary>
                    <p className={styles.mergeIntro}>
                      When the same task or risk shows up in more than one report, we keep the most recent version. Identical
                      priorities keep the earliest. Each source&apos;s own summary isn&apos;t merged -- you&apos;ll write a
                      fresh one in the wizard.
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
                                <Badge tone="sage">Merged ×{entry.mergedFromIds.length}</Badge>
                              </>
                            ) : null}
                          </>
                        ),
                        mergedFrom: entry.mergedFromIds
                          .map((id) => (sourcesById.get(id) ? reportPeriodLabel(sourcesById.get(id)!) : id))
                          .join(', '),
                      }))}
                    />
                  </details>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {step === 4 ? (
          <section className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Create draft</h2>
            {nothingChecked ? (
              <div className={styles.emptyState}>Go back and check at least one report to build a draft.</div>
            ) : (
              <>
                <p className={styles.stepIntro}>
                  Your new draft for {weekLabel} will contain <strong>{draft.tasks.length}</strong> task
                  {draft.tasks.length === 1 ? '' : 's'}, <strong>{draft.risks.length}</strong> risk{draft.risks.length === 1 ? '' : 's'},{' '}
                  <strong>{draft.priorities.length}</strong> priorit{draft.priorities.length === 1 ? 'y' : 'ies'}, and{' '}
                  <strong>{touchTotal}</strong> touchpoint{touchTotal === 1 ? '' : 's'}. It&apos;s created as a Draft -- your
                  source reports are never edited or deleted, and you&apos;ll finish editing in the familiar wizard.
                </p>
                {createError ? (
                  // NIT fix (post-review round 2): `role="alert"`, not
                  // `role="status"` -- see TaskViewScreen.tsx's identical fix.
                  <p className={styles.createError} role="alert">
                    {createError}
                  </p>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        <div className={styles.stepNav}>
          {step > 1 ? (
            <Button variant="outline" size="md" onClick={() => setStep((s) => s - 1)}>
              &larr; Back
            </Button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <Button variant="primary" size="md" onClick={() => setStep((s) => s + 1)}>
              Next &rarr;
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={handleCreate} disabled={nothingChecked || isCreating}>
              {isCreating ? 'Creating…' : 'Create draft'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
