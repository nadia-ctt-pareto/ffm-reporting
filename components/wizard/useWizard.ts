'use client';

import { useState } from 'react';
import { nowDate, uid } from '@/lib/format';
import { aggregateDailiesIntoDraft, carryForwardUnfinishedTasks } from '@/lib/aggregate';
import type { CarryForwardResult } from '@/lib/aggregate';
import { projectIdForClientName } from '@/lib/projects';
import {
  blankDailyDraft,
  blankDraft,
  dailyDateConflict,
  draftToReport,
  reportPeriodEnd,
  reportPeriodLabel,
  taskCompletionStamp,
  validateStep,
} from '@/lib/report-utils';
import type { AnyReport, DailyReport, Draft, Priority, Project, ReportKind, Risk, Task } from '@/lib/types';

export interface ImportCandidate {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

/**
 * Auto carry-forward on a NEW report: the dismissible note shown at the top
 * of the Task Status step once, right after mount, when unfinished tasks
 * were pulled in from the most recent prior SAME-KIND report (see
 * `carryForwardUnfinishedTasks`, lib/aggregate.ts). `taskIds` is what makes
 * Undo precise -- it lists ONLY the ids `initialCarryForward` itself minted
 * (see useWizard's own state below), so Undo can never remove a task the
 * user added manually afterward, even one with the identical (client, task)
 * text as a carried one -- ids, not content, are what Undo matches on.
 */
export interface CarryForwardNoteState {
  /** The prior report's period label (e.g. "Week of Jul 13–17, 2026" or "Jul 17, 2026") -- see reportPeriodLabel. */
  sourceLabel: string;
  blockedCount: number;
  inProgressCount: number;
  taskIds: string[];
}

interface ImportSelState {
  taskSource: string;
  taskChecked: Record<string, boolean>;
  riskSource: string;
  riskChecked: Record<string, boolean>;
  prioritySource: string;
  priorityChecked: Record<string, boolean>;
}

/** Line 515 */
function blankImportSel(): ImportSelState {
  return { taskSource: '', taskChecked: {}, riskSource: '', riskChecked: {}, prioritySource: '', priorityChecked: {} };
}

/** Converts a saved AnyReport into a Draft -- the missing period pair (date for weekly, weekStart/weekEnd for daily) is filled with ''. */
function reportToDraft(report: AnyReport): Draft {
  if (report.kind === 'daily') return { ...report, weekStart: '', weekEnd: '' };
  return { ...report, date: '' };
}

export interface UseWizardOptions {
  /** Which kind of report this wizard mount is drafting -- decides the blank-draft shape and which fields draftToReport emits. */
  kind: ReportKind;
  /**
   * Phase 7b: returns the underlying `Promise<void>` from `useReports().
   * upsertReport`/`useDailyReports().upsertReport` (via WizardPage) --
   * `saveDraft()` below awaits it and surfaces a rejection through the
   * wizard's existing `error` channel, same as a step-validation failure.
   */
  onSaveDraft: (report: AnyReport) => Promise<void>;
  /**
   * Phase 7b: same contract as `onSaveDraft`. `publish()` below only calls
   * `setPublished(true)` AFTER this resolves -- a failed persist must never
   * show the publish-confirmation screen for a report that doesn't exist
   * server-side.
   */
  onPublish: (report: AnyReport) => Promise<void>;
  /**
   * ALL daily reports (used only by the weekly wizard's "Import This Week's
   * Daily Reports" action -- see weekDailyCount/importWeekDailies below).
   * Omit/pass `[]` for the daily wizard itself.
   */
  dailies?: DailyReport[];
  /**
   * Phase 6a: all known projects -- used to stamp a Task/Risk's `projectId`
   * via exact-name match (`projectIdForClientName`) whenever its `client`
   * field is edited (see updateTask/updateRisk below). No project creation
   * happens from the wizard in Phase 6 -- that's Phase 6b's CSV importer.
   */
  projects?: Project[];
  /**
   * WP3 (the access flip): the signed-in user's id (`useSession().user?.id`,
   * threaded through `WizardPage` -> `WizardScreen` -> here), passed to
   * `dailyDateConflict`/`validateStep` so the one-daily-per-day check is
   * scoped to dailies owned by THIS caller -- see `lib/report-utils.ts`'s
   * `sameReportOwner` doc comment for why: under scoped reads, a pm/admin
   * now sees every teammate's daily report, and without this scoping a
   * pm/admin drafting their OWN daily would get a false "already exists"
   * against a teammate's report for the same date. `undefined` in demo mode
   * (no session concept) degrades to the pre-WP3, un-scoped behavior.
   */
  currentUserId?: string | null;
}

export interface UseWizardResult {
  draft: Draft;
  step: number;
  error: string;
  published: boolean;
  /**
   * Phase 8d (editing a published report): true when this wizard mount opened on an already-published report
   * (`initialReport.status !== 'Draft'`, i.e. `'Final'` or `'Sent'`) --
   * captured ONCE at mount (see the `useState(() => ...)` initializer below),
   * never re-derived from the live, editable `draft.status`. This is
   * deliberate: `draft.status` can itself flip mid-session (e.g. the Status
   * <Select> on the report screen, or a future in-wizard status control), and
   * `wasPublished` answers a different question -- "did the user arrive here
   * to CORRECT something that already went out the door", which is fixed for
   * the lifetime of this mount -- not "what does the draft's status field say
   * right now". WizardScreen reads this to pick resume-aware copy ("Editing
   * Report" vs. "Editing Draft", "Save Changes" vs. "Save Draft", "Update
   * Report" vs. "Publish Report", "Report Updated" vs. "Report Published").
   */
  wasPublished: boolean;

  setDraftField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  setTouchpointsField: <K extends keyof Draft['touchpoints']>(field: K, value: Draft['touchpoints'][K]) => void;
  setWinField: <K extends keyof Draft['win']>(field: K, value: Draft['win'][K]) => void;

  addTask: () => void;
  updateTask: <F extends keyof Task>(id: string, field: F, value: Task[F]) => void;
  removeTask: (id: string) => void;

  addRisk: () => void;
  updateRisk: <F extends keyof Risk>(id: string, field: F, value: Risk[F]) => void;
  removeRisk: (id: string) => void;

  addPriority: () => void;
  updatePriority: <F extends keyof Priority>(id: string, field: F, value: Priority[F]) => void;
  removePriority: (id: string) => void;

  goToStep: (n: number) => void;
  next: () => void;
  back: () => void;

  /** Phase 7b: `Promise<void>` -- resolves once the draft has actually persisted (or was rejected by client-side validation before ever calling `onSaveDraft`). Callers may `await` it (WizardScreen's "Save Draft" button doesn't need to) or fire-and-forget it, same as before. */
  saveDraft: () => Promise<void>;
  /** Phase 7b: `Promise<void>` -- `published` (below) only flips to `true` once this resolves; a rejection leaves the wizard on its current step with `error` set, per StepReview's `onPublish={wizard.publish}`. */
  publish: () => Promise<void>;
  /** Phase 7b (SHOULD-FIX 16): true while `saveDraft`/`publish` has an in-flight network write. `publish()` is now a real round-trip with no prior in-flight affordance -- on a slow link the buttons looked dead and invited a duplicate click (harmless, the write queue makes a duplicate POST idempotent, but still worth disabling). WizardScreen disables both "Save Draft" and "Publish Report" while this is true. */
  isSubmitting: boolean;

  priorReportOptions: { value: string; label: string }[];

  /** Auto carry-forward on a NEW report: `null` whenever nothing was auto-imported (resumed draft/published report, no prior same-kind report, or the prior report had zero unfinished tasks) OR after Dismiss/Undo. Rendered by StepTasks. */
  carryForwardNote: CarryForwardNoteState | null;
  /** Hides the note without touching any carried task. */
  dismissCarryForward: () => void;
  /** Removes exactly the auto-carried tasks (matched by id, see CarryForwardNoteState.taskIds) and hides the note. Never re-imports afterward -- see this file's carry-forward state doc comment. */
  undoCarryForward: () => void;

  importTaskSource: string;
  onImportTaskSourceChange: (value: string) => void;
  importTaskCandidates: ImportCandidate[];
  importTaskDisabled: boolean;
  importSelectedTasks: () => void;

  importRiskSource: string;
  onImportRiskSourceChange: (value: string) => void;
  importRiskCandidates: ImportCandidate[];
  importRiskDisabled: boolean;
  importSelectedRisks: () => void;

  importPrioritySource: string;
  onImportPrioritySourceChange: (value: string) => void;
  importPriorityCandidates: ImportCandidate[];
  importPriorityDisabled: boolean;
  importSelectedPriorities: () => void;

  /** Weekly wizard only: how many daily reports fall inside the draft's current [weekStart, weekEnd]. Always 0 for a daily draft. */
  weekDailyCount: number;
  /** Weekly wizard only: whether the CURRENT [weekStart, weekEnd] has already been imported this wizard session -- see importWeekDailies. */
  weekDailiesImported: boolean;
  /**
   * Weekly wizard only: aggregates this week's daily reports into the
   * draft (see lib/aggregate.ts). No-op if weekDailyCount is 0 OR
   * weekDailiesImported is already true -- tasks/risks/priorities/win are
   * naturally idempotent on re-import, but touchpoints (summed) and the
   * touchpoints narrative (joined) are NOT, so import is a one-shot action
   * per distinct [weekStart, weekEnd] pair for the life of this wizard
   * mount. Changing the week to one not yet imported re-enables it.
   */
  importWeekDailies: () => void;
}

type DraftListKey = 'tasks' | 'risks' | 'priorities';

/**
 * Owns the in-progress report draft plus all wizard navigation/import state.
 * Ported from design-source/original-dashboard.dc.html's Component class
 * (script block lines 508-792) -- specifically the wizardStep/draft/
 * wizardError/wizardPublished/importSel slice of state and the methods that
 * operate on it (lines 521-604), plus the derived import-candidate values
 * from renderVals() (lines 688-699).
 *
 * Phase 4: generalized to AnyReport via `options.kind` (decides the blank
 * draft and which fields draftToReport emits) -- `reports` is always the
 * SAME-KIND prior-reports list (weeklies for the weekly wizard, dailies for
 * the daily wizard), which is what keeps the carry-forward Import panels
 * (steps 2/4/5) working unchanged for both kinds. `options.dailies` is a
 * separate, always-ALL-dailies list used only by the weekly wizard's
 * "Import This Week's Daily Reports" action.
 *
 * Auto carry-forward on a NEW report: distinct from the MANUAL, always-
 * available Import panels above -- this hook also auto-imports unfinished
 * (Blocked/In Progress) tasks from the most recent same-kind prior report
 * exactly once, at mount, but ONLY when `initialReport === null` (a
 * genuinely new report; never a resumed draft or a resumed published
 * report). See `initialCarryForward`/`carryForwardNote`/`undoCarryForward`
 * below and `lib/aggregate.ts`'s `carryForwardUnfinishedTasks`.
 */
export function useWizard(reports: AnyReport[], initialReport: AnyReport | null, options: UseWizardOptions): UseWizardResult {
  /**
   * Auto carry-forward on a NEW report: computed ONCE, via a lazy `useState`
   * initializer -- the exact same "compute once at mount, never again"
   * technique `wasPublished` below already uses -- so this is guaranteed to
   * run exactly once per wizard mount regardless of re-renders, with no
   * separate effect/ref bookkeeping needed. `initialReport === null` is the
   * ONLY signal this checks for "is this a genuinely NEW report": resuming
   * an existing draft OR a published report both pass a non-null
   * `initialReport`, so neither ever triggers this (per the plan: "resuming
   * an existing draft or editing a published report must NEVER auto-import").
   *
   * The source is "the most recent prior report of the SAME kind by
   * reportPeriodEnd" -- the identical formula `priorReports`/`defaultSourceId`
   * further down compute, just inlined here: that `const` isn't declared
   * yet at this point in the function body, and its own `r.id !== draft.id`
   * filter is a no-op for a brand-new draft anyway (`draft.id` is always
   * `null` here, and no real report ever has a `null` id), so this produces
   * the exact same source report `priorReports[0]` would.
   */
  const [initialCarryForward] = useState<CarryForwardResult | null>(() => {
    if (initialReport !== null) return null;
    const source = [...reports].sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)))[0];
    if (!source) return null;
    // Dedupe against an empty task list: a brand-new draft has no tasks yet
    // at this point (blankDraft()/blankDailyDraft() both start empty) --
    // but `carryForwardUnfinishedTasks` still takes `existingTasks` as a
    // real parameter rather than special-casing "always empty" here, so its
    // dedupe contract is exercised identically for every caller.
    return carryForwardUnfinishedTasks(source, []);
  });

  const [draft, setDraft] = useState<Draft>(() => {
    if (initialReport) return reportToDraft(initialReport);
    const blank = options.kind === 'daily' ? blankDailyDraft() : blankDraft();
    if (!initialCarryForward || initialCarryForward.tasks.length === 0) return blank;
    return { ...blank, tasks: [...blank.tasks, ...initialCarryForward.tasks] };
  });

  // The dismissible note StepTasks renders -- `null` whenever nothing was
  // auto-imported (no prior same-kind report, or the prior report had zero
  // unfinished tasks) OR after Dismiss/Undo (see those functions below).
  const [carryForwardNote, setCarryForwardNote] = useState<CarryForwardNoteState | null>(() =>
    initialCarryForward && initialCarryForward.tasks.length > 0
      ? {
          sourceLabel: reportPeriodLabel(initialCarryForward.source),
          blockedCount: initialCarryForward.blockedCount,
          inProgressCount: initialCarryForward.inProgressCount,
          taskIds: initialCarryForward.tasks.map((t) => t.id),
        }
      : null
  );

  /** Hides the note without touching any carried task -- the user has seen it and moved on. */
  function dismissCarryForward() {
    setCarryForwardNote(null);
  }

  /**
   * Removes exactly the tasks `initialCarryForward` added (matched by id,
   * captured in `carryForwardNote.taskIds` at mount) and hides the note.
   * Never touches a task the user added manually since, even one sharing
   * the same (client, task) text as a carried one -- ids, not content, are
   * what this matches on. Does not re-run the import afterward: nothing in
   * this hook re-invokes `carryForwardUnfinishedTasks` past mount, so Undo
   * is a one-way action for the life of this wizard mount, exactly as the
   * plan requires ("after Undo, do not silently re-import").
   */
  function undoCarryForward() {
    if (!carryForwardNote) return;
    const ids = new Set(carryForwardNote.taskIds);
    setDraft((d) => ({ ...d, tasks: d.tasks.filter((t) => !ids.has(t.id)) }));
    setCarryForwardNote(null);
  }
  // Phase 8d (editing a published report): captured once, from `initialReport` (the value this hook was
  // mounted with), NOT from the mutable `draft` state -- see the
  // `wasPublished` doc comment on UseWizardResult for why re-deriving it
  // from `draft.status` on every render would be wrong.
  const [wasPublished] = useState(() => initialReport !== null && initialReport.status !== 'Draft');
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importSel, setImportSel] = useState<ImportSelState>(blankImportSel);
  // Phase 4: which `weekStart|weekEnd` keys have already been imported this
  // wizard session (see importWeekDailies below) -- a Set, not a single
  // flag, so importing week A, then week B, then navigating step 1 back to
  // week A stays correctly disabled (re-importing A a second time would
  // double its touchpoints again).
  const [importedWeekKeys, setImportedWeekKeys] = useState<Set<string>>(() => new Set());

  // Same-kind sibling reports, narrowed to DailyReport[] -- non-empty only
  // for the daily wizard (where `reports` IS the dailies list); used for
  // the one-daily-per-day uniqueness check (dailyDateConflict/validateStep).
  const dailySiblings = reports.filter((r): r is DailyReport => r.kind === 'daily');

  // ---- generic draft list ops (lines 558-560) ----
  function addDraftItem<L extends DraftListKey>(list: L, factory: () => Draft[L][number]) {
    setDraft((d) => ({ ...d, [list]: [...d[list], factory()] }) as Draft);
  }
  function removeDraftItem<L extends DraftListKey>(list: L, id: string) {
    setDraft((d) => ({ ...d, [list]: (d[list] as { id: string }[]).filter((it) => it.id !== id) }) as Draft);
  }
  function updateDraftItem<L extends DraftListKey>(list: L, id: string, field: string, value: unknown) {
    setDraft(
      (d) =>
        ({
          ...d,
          [list]: (d[list] as { id: string }[]).map((it) => (it.id === id ? { ...it, [field]: value } : it)),
        }) as Draft
    );
  }

  // ---- tasks (line 561-563) ----
  /**
   * WP2: this is a genuine CREATION site (a brand-new task row, not a
   * carry-forward/import/aggregation copy of an existing one) -- stamps
   * `createdAt` to today, the same `nowDate()` every other status-change
   * write path in this file already reads. `assigneeId` is left unset
   * (undefined) -- a freshly added row starts unassigned; the row's own
   * assignee `<Select>` (StepTasks.tsx) is how a PM picks one afterward,
   * the same way `client`/`task` start blank and get filled in via the
   * row's own fields.
   */
  function addTask() {
    addDraftItem('tasks', () => ({ id: uid('t'), client: '', task: '', status: 'In Progress', deadline: '', createdAt: nowDate() }));
  }
  /**
   * Phase 6a: when `field` is `'client'`, also stamps `projectId` via an
   * exact-name match against `options.projects` (undefined on no match --
   * never creates a project from the wizard, see UseWizardOptions.projects).
   *
   * Task completion date: when `field` is `'status'`, this is the wizard's
   * own status-change write path (`StepTasks.tsx`'s Status select) -- it
   * stamps/clears `completedAt` via the SAME `taskCompletionStamp` rule
   * `withTaskStatus`/`withTaskEdited` use (lib/report-utils.ts), so the rule
   * cannot drift between the wizard and the other two write paths. This
   * branches BEFORE calling `updateDraftItem` (rather than after) because it
   * needs the task's CURRENT (pre-change) status/completedAt to decide the
   * transition -- `updateDraftItem` alone would already have overwritten
   * `status` by the time a second read could see the old value.
   */
  function updateTask<F extends keyof Task>(id: string, field: F, value: Task[F]) {
    if (field === 'status') {
      const nextStatus = value as Task['status'];
      const today = nowDate();
      setDraft((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, status: nextStatus, completedAt: taskCompletionStamp(t, nextStatus, today) } : t)),
      }));
      return;
    }
    updateDraftItem('tasks', id, field, value);
    if (field === 'client') {
      updateDraftItem('tasks', id, 'projectId', projectIdForClientName(value as string, options.projects ?? []));
    }
  }
  function removeTask(id: string) {
    removeDraftItem('tasks', id);
  }

  // ---- risks (line 564-566) ----
  function addRisk() {
    addDraftItem('risks', () => ({ id: uid('rk'), client: '', severity: 'At Risk', description: '', nextStep: '' }));
  }
  /** Phase 6a: see updateTask -- same client -> projectId stamping. */
  function updateRisk<F extends keyof Risk>(id: string, field: F, value: Risk[F]) {
    updateDraftItem('risks', id, field, value);
    if (field === 'client') {
      updateDraftItem('risks', id, 'projectId', projectIdForClientName(value as string, options.projects ?? []));
    }
  }
  function removeRisk(id: string) {
    removeDraftItem('risks', id);
  }

  // ---- priorities (line 567-569) ----
  function addPriority() {
    addDraftItem('priorities', () => ({ id: uid('p'), text: '' }));
  }
  function updatePriority<F extends keyof Priority>(id: string, field: F, value: Priority[F]) {
    updateDraftItem('priorities', id, field, value);
  }
  function removePriority(id: string) {
    removeDraftItem('priorities', id);
  }

  // ---- field setters (lines 571-573) ----
  function setDraftField<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }
  function setTouchpointsField<K extends keyof Draft['touchpoints']>(field: K, value: Draft['touchpoints'][K]) {
    setDraft((d) => ({ ...d, touchpoints: { ...d.touchpoints, [field]: value } }));
  }
  function setWinField<K extends keyof Draft['win']>(field: K, value: Draft['win'][K]) {
    setDraft((d) => ({ ...d, win: { ...d.win, [field]: value } }));
  }

  // ---- navigation (lines 529, 537-538) ----
  function goToStep(n: number) {
    if (n <= step && !published) {
      setStep(n);
      setError('');
    }
  }
  function next() {
    const err = validateStep(step, draft, dailySiblings, options.currentUserId);
    if (err) {
      setError(err);
      return;
    }
    setStep((s) => Math.min(6, s + 1));
    setError('');
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
    setError('');
  }

  // ---- draft persistence (lines 542-553) ----
  /**
   * Phase 7b: awaits `options.onSaveDraft` and surfaces a rejection through
   * the SAME `error` channel step-validation already uses (rather than a
   * separate error slice) -- the plan's explicit instruction ("a rejection
   * lands in the wizard's existing error channel"), and it's what makes a
   * failed autosave visible on whatever step the user is currently on.
   *
   * BLOCKER 2 fix: "Save Draft" otherwise bypasses per-step validation
   * entirely (`blankDraft()` returns `weekStart: ''`/`weekEnd: ''`/
   * `date: ''` -- a documented faithful-port quirk, see CLAUDE.md
   * "Conventions") -- but the Supabase schema's `isoDate` fields AND the
   * `reports_period_by_kind` CHECK constraint both REQUIRE a report's
   * period field(s) to be non-empty, so a period-less draft used to reach
   * the wire and come back as a raw `Invalid request body.` 400. The
   * period check below narrows that quirk explicitly, client-side, with a
   * real message -- everything else (tasks/risks/priorities/preparedFor
   * can still be empty) stays exactly as loose as before; this is NOT full
   * step-1 validation (`validateStep`), just the one thing the schema/DB
   * genuinely can't accept.
   *
   * Phase 8d (editing a published report): `draftToReport` is now called with `draft.status`, not a hardcoded
   * `'Draft'` literal. This is the fix for the "saveDraft always forces
   * Draft" faithful-port quirk (see CLAUDE.md, superseded by this package
   * the same way the two dark-mode quirks were superseded in Phase 1) --
   * `blankDraft()`/`blankDailyDraft()` seed `status: 'Draft'` and
   * `reportToDraft()` carries a resumed report's ACTUAL status through
   * (`{...report}` spread), so this is a no-op for a brand-new draft or a
   * resumed Draft (both still write `'Draft'`, byte-identical to before) --
   * it only changes behavior for a resumed Final/Sent report, where a header
   * "Save Draft"/"Save Changes" click now preserves that status instead of
   * silently demoting it back to `'Draft'`.
   */
  async function saveDraft() {
    if (draft.kind === 'daily') {
      if (!draft.date) {
        setError('Add a report date before saving a draft.');
        return;
      }
    } else if (!draft.weekStart || !draft.weekEnd) {
      setError('Add a week start and end date before saving a draft.');
      return;
    }
    // The one-daily-per-day invariant is a hard data-integrity rule, not a
    // step-gate, so it's checked here too, not just on `next()`/`publish()`.
    if (dailyDateConflict(draft, dailySiblings, options.currentUserId)) {
      setError('A daily report for this date already exists.');
      return;
    }
    const id = draft.id || uid(draft.kind === 'daily' ? 'd' : 'r');
    const now = nowDate();
    const report = draftToReport(draft, id, draft.status, now);
    setIsSubmitting(true);
    try {
      await options.onSaveDraft(report);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Sane rewrite of the prototype's string-comparison step-resolution
   * (`err === validateStep(1) ? 1 : err === validateStep(2) ? 2 : 5`,
   * line 549) -- identical behavior: validate steps 1, 2, 5 in order,
   * short-circuiting exactly like the original `||` chain (an empty-string
   * error is falsy), and jump to whichever step produced the first error.
   *
   * Phase 7b: `setPublished(true)` moved to AFTER `options.onPublish`
   * resolves -- a failed persist must never show the publish-confirmation
   * screen for a report that doesn't exist server-side (the exact failure
   * class this milestone exists to prevent, see the Phase 7b plan's
   * "Risks"). `draft.id` is still stamped BEFORE the await either way, so a
   * retry after a failure reuses the same id rather than minting a new one
   * on every attempt.
   *
   * Phase 8d (editing a published report): the persisted status is `draft.status === 'Sent' ? 'Sent' : 'Final'`,
   * not an unconditional `'Final'` literal -- republishing an already-`Sent`
   * report (e.g. correcting a typo after it was emailed out) must not
   * silently demote it back to `'Final'`. This is the same bug class the
   * `saveDraft` fix above closes, one lifecycle stage later: `'Draft'` ->
   * `'Final'` -> `'Sent'` is a one-way ratchet everywhere else in this app
   * (there is no in-wizard way to mark a report `'Sent'` at all yet -- that
   * only happens via the report screen's Status `<Select>` -- so the ONLY
   * way `draft.status` can already be `'Sent'` when `publish()` runs is a
   * resumed `Sent` report), and `publish()` must never be the one place that
   * quietly reverses it. A brand-new or resumed-Draft/Final report still
   * writes `'Final'` here, exactly as before.
   */
  async function publish() {
    const err1 = validateStep(1, draft, dailySiblings, options.currentUserId);
    const err2 = err1 ? '' : validateStep(2, draft);
    const err5 = err1 || err2 ? '' : validateStep(5, draft);
    const err = err1 || err2 || err5;
    if (err) {
      setError(err);
      setStep(err1 ? 1 : err2 ? 2 : 5);
      return;
    }
    const id = draft.id || uid(draft.kind === 'daily' ? 'd' : 'r');
    const now = nowDate();
    const publishedStatus = draft.status === 'Sent' ? 'Sent' : 'Final';
    const report = draftToReport(draft, id, publishedStatus, now);
    // The id is stamped BEFORE the await on purpose: a failed publish must be
    // retryable against the same id rather than minting a second report.
    setDraft((d) => ({ ...d, id }));
    setIsSubmitting(true);
    try {
      await options.onPublish(report);
      // `status` is stamped ONLY after the write actually resolves -- see the
      // post-review finding this fixes. Stamping it beside `id` above (as an
      // earlier revision did) promoted the in-memory draft to 'Final' even
      // when the publish REJECTED: the user stayed on the Review step with
      // the header Save button live, clicked "Save Draft", and `saveDraft()`
      // -- which now faithfully writes `draft.status` -- persisted a report
      // as 'Final' that had never been published successfully. It then showed
      // as Final on the dashboard.
      //
      // Stamping here still satisfies the reason the stamp exists at all: the
      // publish-confirmation screen (whose header Save button stays live, see
      // WizardScreen.tsx) only ever renders after this line has run, so a
      // post-publish "Save" reads the promoted status and can no longer demote
      // the just-published report back to 'Draft'.
      setDraft((d) => ({ ...d, status: publishedStatus }));
      setPublished(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- import machinery (lines 576-604, derived candidates 688-699) ----
  const priorReports = [...reports].filter((r) => r.id !== draft.id).sort((a, b) => reportPeriodEnd(b).localeCompare(reportPeriodEnd(a)));
  const priorReportOptions = priorReports.map((r) => ({
    value: r.id,
    label: reportPeriodLabel(r) + ' — ' + r.status,
  }));
  const defaultSourceId = priorReports[0]?.id ?? '';

  // The resolved source id (selected-or-default) is shared by both the
  // rendered candidate list AND the import action below, so importing with
  // an untouched (default) select still works.
  const importTaskSourceId = importSel.taskSource || defaultSourceId;
  const importRiskSourceId = importSel.riskSource || defaultSourceId;
  const importPrioritySourceId = importSel.prioritySource || defaultSourceId;

  const taskSrc = reports.find((r) => r.id === importTaskSourceId) ?? null;
  const riskSrc = reports.find((r) => r.id === importRiskSourceId) ?? null;
  const prioritySrc = reports.find((r) => r.id === importPrioritySourceId) ?? null;

  function toggleImportChecked(mapKey: 'taskChecked' | 'riskChecked' | 'priorityChecked', id: string) {
    setImportSel((s) => ({ ...s, [mapKey]: { ...s[mapKey], [id]: !s[mapKey][id] } }));
  }

  const importTaskCandidates: ImportCandidate[] = taskSrc
    ? taskSrc.tasks
        .filter((t) => t.status !== 'Complete' && !draft.tasks.some((dt) => dt.client === t.client && dt.task === t.task))
        .map((t) => ({
          id: t.id,
          label: `${t.client} — ${t.task} (${t.status})`,
          checked: !!importSel.taskChecked[t.id],
          onToggle: () => toggleImportChecked('taskChecked', t.id),
        }))
    : [];

  const importRiskCandidates: ImportCandidate[] = riskSrc
    ? riskSrc.risks
        .filter((rk) => !draft.risks.some((dr) => dr.client === rk.client && dr.description === rk.description))
        .map((rk) => ({
          id: rk.id,
          label: `${rk.client} — ${rk.severity}: ${rk.description}`,
          checked: !!importSel.riskChecked[rk.id],
          onToggle: () => toggleImportChecked('riskChecked', rk.id),
        }))
    : [];

  const importPriorityCandidates: ImportCandidate[] = prioritySrc
    ? prioritySrc.priorities
        .filter((p) => !draft.priorities.some((dp) => dp.text === p.text))
        .map((p) => ({
          id: p.id,
          label: p.text,
          checked: !!importSel.priorityChecked[p.id],
          onToggle: () => toggleImportChecked('priorityChecked', p.id),
        }))
    : [];

  function onImportTaskSourceChange(value: string) {
    setImportSel((s) => ({ ...s, taskSource: value, taskChecked: {} }));
  }
  function onImportRiskSourceChange(value: string) {
    setImportSel((s) => ({ ...s, riskSource: value, riskChecked: {} }));
  }
  function onImportPrioritySourceChange(value: string) {
    setImportSel((s) => ({ ...s, prioritySource: value, priorityChecked: {} }));
  }

  function importSelectedTasks() {
    if (!taskSrc) return;
    const candidates = taskSrc.tasks.filter(
      (t) => t.status !== 'Complete' && !draft.tasks.some((dt) => dt.client === t.client && dt.task === t.task)
    );
    const chosen = candidates.filter((t) => importSel.taskChecked[t.id]);
    if (!chosen.length) return;
    // Phase 6b: carries `t.projectId` through verbatim -- dropping it here
    // was harmless pre-6b (ensureProjectIds re-derives it next load from
    // `client === project.name`), but became silent data loss once an
    // imported task's `client` string could differ from its project's
    // `name` (the CSV importer, lib/import.ts).
    //
    // WP2: `assigneeId` carries through verbatim too, same rationale as
    // `projectId` -- durable ownership metadata, not a point-in-time event.
    // `createdAt` is deliberately NOT carried -- this mints a fresh `id` for
    // every imported task, same as `carryForwardUnfinishedTasks`/
    // `aggregateReportsIntoDraft` (lib/aggregate.ts), so it gets the exact
    // same "new, independent record -- don't fabricate a creation date"
    // treatment; see that file's doc comment for the full reasoning.
    const newTasks: Task[] = chosen.map((t) => ({ id: uid('t'), client: t.client, projectId: t.projectId, task: t.task, status: t.status, deadline: t.deadline, assigneeId: t.assigneeId }));
    setDraft((d) => ({ ...d, tasks: [...d.tasks, ...newTasks] }));
    setImportSel((s) => ({ ...s, taskChecked: {} }));
  }

  function importSelectedRisks() {
    if (!riskSrc) return;
    const candidates = riskSrc.risks.filter((rk) => !draft.risks.some((dr) => dr.client === rk.client && dr.description === rk.description));
    const chosen = candidates.filter((rk) => importSel.riskChecked[rk.id]);
    if (!chosen.length) return;
    // Phase 6b: see the identical note in importSelectedTasks() above --
    // carries `rk.projectId` through verbatim.
    const newRisks: Risk[] = chosen.map((rk) => ({ id: uid('rk'), client: rk.client, projectId: rk.projectId, severity: rk.severity, description: rk.description, nextStep: rk.nextStep }));
    setDraft((d) => ({ ...d, risks: [...d.risks, ...newRisks] }));
    setImportSel((s) => ({ ...s, riskChecked: {} }));
  }

  function importSelectedPriorities() {
    if (!prioritySrc) return;
    const candidates = prioritySrc.priorities.filter((p) => !draft.priorities.some((dp) => dp.text === p.text));
    const chosen = candidates.filter((p) => importSel.priorityChecked[p.id]);
    if (!chosen.length) return;
    const newPriorities: Priority[] = chosen.map((p) => ({ id: uid('p'), text: p.text }));
    setDraft((d) => ({ ...d, priorities: [...d.priorities, ...newPriorities] }));
    setImportSel((s) => ({ ...s, priorityChecked: {} }));
  }

  // ---- Phase 4: weekly wizard's "Import This Week's Daily Reports" ----
  // Recomputed live off the draft's current weekStart/weekEnd, so editing
  // the week dates on step 1 updates the found-count before importing.
  const allDailies = options.dailies ?? [];
  const hasWeek = draft.kind === 'weekly' && Boolean(draft.weekStart) && Boolean(draft.weekEnd);
  const weekKey = hasWeek ? `${draft.weekStart}|${draft.weekEnd}` : null;
  const weekDailies = hasWeek
    ? allDailies.filter((d) => d.date.localeCompare(draft.weekStart) >= 0 && d.date.localeCompare(draft.weekEnd) <= 0)
    : [];
  const weekDailyCount = weekDailies.length;
  // Import is one-shot per distinct week for this wizard mount -- tasks/
  // risks/priorities/win are naturally idempotent on re-import, but
  // touchpoints (summed) and its narrative (joined) are NOT, so a second
  // click on the same week must be a no-op, not a second sum. See the
  // UseWizardResult doc comment.
  const weekDailiesImported = weekKey !== null && importedWeekKeys.has(weekKey);

  function importWeekDailies() {
    if (weekDailies.length === 0 || weekKey === null || weekDailiesImported) return;
    setDraft((d) => aggregateDailiesIntoDraft(weekDailies, d));
    setImportedWeekKeys((prev) => new Set(prev).add(weekKey));
  }

  return {
    draft,
    step,
    error,
    published,
    wasPublished,
    isSubmitting,

    setDraftField,
    setTouchpointsField,
    setWinField,

    addTask,
    updateTask,
    removeTask,

    addRisk,
    updateRisk,
    removeRisk,

    addPriority,
    updatePriority,
    removePriority,

    goToStep,
    next,
    back,

    saveDraft,
    publish,

    priorReportOptions,

    carryForwardNote,
    dismissCarryForward,
    undoCarryForward,

    importTaskSource: importTaskSourceId,
    onImportTaskSourceChange,
    importTaskCandidates,
    importTaskDisabled: !importTaskCandidates.some((c) => c.checked),
    importSelectedTasks,

    importRiskSource: importRiskSourceId,
    onImportRiskSourceChange,
    importRiskCandidates,
    importRiskDisabled: !importRiskCandidates.some((c) => c.checked),
    importSelectedRisks,

    importPrioritySource: importPrioritySourceId,
    onImportPrioritySourceChange,
    importPriorityCandidates,
    importPriorityDisabled: !importPriorityCandidates.some((c) => c.checked),
    importSelectedPriorities,

    weekDailyCount,
    weekDailiesImported,
    importWeekDailies,
  };
}
