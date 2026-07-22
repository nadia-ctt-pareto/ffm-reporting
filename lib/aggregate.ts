// Phase 4: pure aggregation of a week's daily reports into an in-progress
// weekly Draft, powering the weekly wizard's "Import This Week's Daily
// Reports" action (StepBasics, wired through useWizard.importWeekDailies).
//
// Phase 6b: generalized to `aggregateReportsIntoDraft(sources, draft)`,
// which accepts ANY mix of weekly + daily `AnyReport`s (not just dailies) --
// powers the `/consolidate` screen (components/consolidate/ConsolidateScreen
// .tsx / lib/consolidate.ts). `aggregateDailiesIntoDraft` remains exported
// as a one-line wrapper so `useWizard.ts` (the weekly wizard's daily-import
// action) does not change AT ALL -- see its doc comment below for why this
// is behavior-identical by construction, not just by inspection.
//
// Nothing here touches storage or React state -- callers are responsible
// for persisting/setting state with the result.
//
// Dedup predicates deliberately reuse the exact (client, task) /
// (client, description) / (text) keys already used by useWizard's
// carry-forward Import panels (steps 2/4/5) -- same "does this already
// exist in the draft" semantics, just fed a whole batch of sources (in
// period-end order) instead of a single prior report.

import { uid } from './format';
import { reportPeriodEnd } from './report-utils';
import type { AnyReport, DailyReport, Draft, Priority, Risk, Task } from './types';

/**
 * The dedupe/identity key for "the same logical task" across reports:
 * exact (client, task-text) match, no fuzzy matching. Exported (not just a
 * private helper) so `lib/task-schedule.ts` (Schedule view) can chain a
 * task's occurrences across weekly reports using the IDENTICAL predicate
 * this aggregator already uses for carry-forward/import dedupe -- two
 * independently-invented "same task" notions would silently drift the
 * moment either changed. A task text edit intentionally starts a NEW chain
 * under both consumers, for the same reason (see this file's own header
 * comment on dedup semantics).
 */
export function taskKey(t: Pick<Task, 'client' | 'task'>): string {
  return `${t.client}::${t.task}`;
}

function riskKey(rk: Pick<Risk, 'client' | 'description'>): string {
  return `${rk.client}::${rk.description}`;
}

/**
 * One entry per (client, task) / (client, description) / priority-text key
 * that ended up added to the draft by `aggregateReportsIntoDraft` -- powers
 * the consolidation screen's "dedupe disclosure" (which keys collapsed,
 * whose version won, which sources contributed). A key already present in
 * `draft` BEFORE aggregation never produces an entry (nothing "collapsed"
 * there -- it was simply skipped, exactly like the pre-Phase-6b algorithm
 * always did). `mergedFromIds.length === 1` just means one source
 * contributed it (no actual collapsing happened, but it's still logged so
 * every resulting item's provenance is visible uniformly).
 */
export interface MergeLogEntry {
  type: 'task' | 'risk' | 'priority';
  /** `'client::task'`, `'client::description'`, or the priority's exact text. */
  key: string;
  /** id of the source report whose version was kept (latest period end -- see the tie-break rule below). */
  keptFromId: string;
  /** id of every checked source that contributed this key, in the order aggregation processed them. */
  mergedFromIds: string[];
}

export interface AggregateResult {
  draft: Draft;
  log: MergeLogEntry[];
}

/**
 * Merges `sources` (weekly and/or daily reports) into `draft` (the
 * in-progress draft being edited/created), returning a NEW Draft (never
 * mutates its inputs) plus a `log` of every key it added:
 *
 * - `sources` are processed in ascending `reportPeriodEnd` order (a daily's
 *   `date`, a weekly's `weekEnd` -- see lib/report-utils.ts) so "later in
 *   the list" means "more recent". On an EXACT period-end tie, a DAILY
 *   outranks a WEEKLY (a secondary sort key, `kind === 'daily' ? 1 : 0`,
 *   also ascending) -- a daily report is fresher-grained information about
 *   that same calendar point, so it sorts after (and therefore wins over)
 *   a weekly ending on the same date.
 * - **tasks**: deduped by (client, task); when the same pair appears in
 *   multiple sources, the LATEST-sorted source's version (status/deadline,
 *   AND `projectId`) wins. Skips any pair already present in `draft.tasks`.
 * - **risks**: deduped by (client, description), latest source's version
 *   (severity/nextStep/projectId) wins. Skips any pair already present in
 *   `draft.risks`.
 * - **priorities**: deduped by exact `text` -- the FIRST (earliest-sorted)
 *   source to introduce a given text is what's kept (there is no
 *   "version" to prefer a later one over, since two priorities with
 *   identical text are identical content by definition; this is verbatim
 *   the pre-Phase-6b behavior). Skips any text already present in
 *   `draft.priorities`.
 * - **touchpoints**: `calls`/`emails`/`escalations` are SUMMED across every
 *   source (added on top of whatever `draft.touchpoints` already had);
 *   `narrative` is every non-empty narrative (draft's own first, if any)
 *   joined with `\n`.
 * - **win**: the LATEST-sorted source with a non-empty win (any of
 *   stat/label/narrative set) -- but ONLY if `draft.win` is currently
 *   empty. A win the user already typed into the draft is never clobbered.
 */
export function aggregateReportsIntoDraft(sources: AnyReport[], draft: Draft): AggregateResult {
  const ordered = [...sources].sort((a, b) => {
    const byEnd = reportPeriodEnd(a).localeCompare(reportPeriodEnd(b));
    if (byEnd !== 0) return byEnd;
    return (a.kind === 'daily' ? 1 : 0) - (b.kind === 'daily' ? 1 : 0);
  });

  const log: MergeLogEntry[] = [];

  // ---- tasks: last write (in `ordered` order) wins ----
  // Contributors are tracked as a Set (not an array) per key: a single
  // source listing the SAME (client, task) pair twice must count as ONE
  // contributor, not two -- an array would double-push that source's id and
  // inflate the "Deduped ×N" count in the UI beyond the actual number of
  // distinct contributing reports.
  const taskByKey = new Map<string, Task>();
  const taskKeptFrom = new Map<string, string>();
  const taskContributors = new Map<string, Set<string>>();
  for (const source of ordered) {
    for (const t of source.tasks) {
      const key = taskKey(t);
      taskByKey.set(key, t);
      taskKeptFrom.set(key, source.id);
      const set = taskContributors.get(key) ?? new Set<string>();
      set.add(source.id);
      taskContributors.set(key, set);
    }
  }
  const newTasks: Task[] = [...taskByKey.entries()]
    .filter(([, t]) => !draft.tasks.some((dt) => dt.client === t.client && dt.task === t.task))
    .map(([key, t]) => {
      log.push({ type: 'task', key, keptFromId: taskKeptFrom.get(key)!, mergedFromIds: [...taskContributors.get(key)!] });
      return { id: uid('t'), client: t.client, projectId: t.projectId, task: t.task, status: t.status, deadline: t.deadline };
    });

  // ---- risks: last write (in `ordered` order) wins ----
  const riskByKey = new Map<string, Risk>();
  const riskKeptFrom = new Map<string, string>();
  const riskContributors = new Map<string, Set<string>>();
  for (const source of ordered) {
    for (const rk of source.risks) {
      const key = riskKey(rk);
      riskByKey.set(key, rk);
      riskKeptFrom.set(key, source.id);
      const set = riskContributors.get(key) ?? new Set<string>();
      set.add(source.id);
      riskContributors.set(key, set);
    }
  }
  const newRisks: Risk[] = [...riskByKey.entries()]
    .filter(([, rk]) => !draft.risks.some((dr) => dr.client === rk.client && dr.description === rk.description))
    .map(([key, rk]) => {
      log.push({ type: 'risk', key, keptFromId: riskKeptFrom.get(key)!, mergedFromIds: [...riskContributors.get(key)!] });
      return { id: uid('rk'), client: rk.client, projectId: rk.projectId, severity: rk.severity, description: rk.description, nextStep: rk.nextStep };
    });

  // ---- priorities: first occurrence (in `ordered` order) wins ----
  const newPriorities: Priority[] = [];
  const seenText = new Set(draft.priorities.map((p) => p.text));
  const priorityContributors = new Map<string, Set<string>>();
  const priorityKeptFrom = new Map<string, string>();
  for (const source of ordered) {
    for (const p of source.priorities) {
      if (seenText.has(p.text)) {
        const contributors = priorityContributors.get(p.text);
        if (contributors) contributors.add(source.id); // only track further contributors for keys THIS aggregation introduced
        continue;
      }
      seenText.add(p.text);
      priorityKeptFrom.set(p.text, source.id);
      priorityContributors.set(p.text, new Set([source.id]));
      newPriorities.push({ id: uid('p'), text: p.text });
    }
  }
  for (const [text, contributors] of priorityContributors) {
    log.push({ type: 'priority', key: text, keptFromId: priorityKeptFrom.get(text)!, mergedFromIds: [...contributors] });
  }

  const touchpoints = {
    calls: draft.touchpoints.calls + ordered.reduce((sum, s) => sum + s.touchpoints.calls, 0),
    emails: draft.touchpoints.emails + ordered.reduce((sum, s) => sum + s.touchpoints.emails, 0),
    escalations: draft.touchpoints.escalations + ordered.reduce((sum, s) => sum + s.touchpoints.escalations, 0),
    narrative: [draft.touchpoints.narrative, ...ordered.map((s) => s.touchpoints.narrative)].filter(Boolean).join('\n'),
  };

  let win = draft.win;
  const draftWinEmpty = !draft.win.stat && !draft.win.label && !draft.win.narrative;
  if (draftWinEmpty) {
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const candidate = ordered[i].win;
      if (candidate.stat || candidate.label || candidate.narrative) {
        // Copy, don't alias -- the returned draft (and whatever it's later
        // published into) must never share a live object reference with
        // the source report still sitting in its own list.
        win = { ...candidate };
        break;
      }
    }
  }

  return {
    draft: {
      ...draft,
      tasks: [...draft.tasks, ...newTasks],
      risks: [...draft.risks, ...newRisks],
      priorities: [...draft.priorities, ...newPriorities],
      touchpoints,
      win,
    },
    log,
  };
}

/**
 * Back-compat wrapper -- `useWizard.ts`'s weekly wizard "Import This Week's
 * Daily Reports" action calls this exact function, unchanged, since before
 * Phase 6b. Behavior-identical BY CONSTRUCTION for a dailies-only input,
 * not just by inspection: `reportPeriodEnd(daily) === daily.date` for every
 * daily (see lib/report-utils.ts), so the sort above reduces to the old
 * `dailies.sort((a, b) => a.date.localeCompare(b.date))`; the kind
 * tie-break never fires (every source has the same `kind`); and every
 * dedup/sum/win rule above is verbatim the pre-Phase-6b algorithm. Verified
 * empirically too, not just argued -- see the scratchpad's aggregator
 * oracle script (deep-equals this against a copy of the exact pre-Phase-6b
 * function body run over the same 5 seed dailies + a blank weekly draft).
 */
export function aggregateDailiesIntoDraft(dailies: DailyReport[], draft: Draft): Draft {
  return aggregateReportsIntoDraft(dailies, draft).draft;
}

/**
 * Auto carry-forward on a NEW report (`useWizard.ts`): the prior same-kind
 * report's `source` and however many freshly-id'd `Task`s got carried into
 * a brand-new draft. `blockedCount`/`inProgressCount` are pre-split so the
 * wizard's dismissible note can read them straight off without re-deriving
 * them from `tasks`.
 */
export interface CarryForwardResult {
  /** The prior same-kind report the tasks came from -- used for the note's "from <period>" copy. */
  source: AnyReport;
  /** Freshly-id'd `Task`s, ready to append to a draft's `tasks` array. */
  tasks: Task[];
  blockedCount: number;
  inProgressCount: number;
}

/**
 * `Blocked`/`In Progress` tasks from `source` -- NEVER `Complete`, an
 * unfinished task carried forward is the whole point -- deduped against
 * `existingTasks` via the EXACT (client, task) predicate `useWizard.ts`'s
 * manual Import panels and `aggregateReportsIntoDraft` above already use (no
 * fuzzy matching, no re-derived notion of "already there"). Each carried
 * task gets a FRESH id (never reuses `source`'s task id -- this is a new,
 * independent task record on the new draft, not a shared reference) and
 * `completedAt` is dropped outright: these are unfinished BY DEFINITION, so
 * a carried task can never coherently have a completion date (even if
 * `source`'s copy somehow had a stale one). `client`/`status`/`deadline`/
 * `projectId` carry verbatim.
 *
 * Pure: never mutates `source` or `existingTasks`, touches no storage.
 * Deliberately NOT used by the manual Import panels (`importSelectedTasks`
 * in useWizard.ts) -- those need live candidate/checkbox selection state
 * this function has no notion of; this is purely the AUTOMATIC, whole-batch
 * "carry everything unfinished" path used once, at wizard mount, for a
 * genuinely new report only (see useWizard.ts's own doc comment on this).
 */
export function carryForwardUnfinishedTasks(source: AnyReport, existingTasks: Task[]): CarryForwardResult {
  const candidates = source.tasks.filter(
    (t) => t.status !== 'Complete' && !existingTasks.some((et) => et.client === t.client && et.task === t.task)
  );
  const tasks: Task[] = candidates.map((t) => ({
    id: uid('t'),
    client: t.client,
    projectId: t.projectId,
    task: t.task,
    status: t.status,
    deadline: t.deadline,
    // completedAt deliberately omitted -- see this function's doc comment.
  }));
  return {
    source,
    tasks,
    blockedCount: tasks.filter((t) => t.status === 'Blocked').length,
    inProgressCount: tasks.filter((t) => t.status === 'In Progress').length,
  };
}
