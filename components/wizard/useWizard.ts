'use client';

import { useState } from 'react';
import { fmtWeekLabel, nowDate, uid } from '@/lib/format';
import { blankDraft, validateStep } from '@/lib/report-utils';
import type { Draft, Priority, Report, Risk, Task } from '@/lib/types';

export interface ImportCandidate {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
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

export interface UseWizardOptions {
  onSaveDraft: (report: Report) => void;
  onPublish: (report: Report) => void;
}

export interface UseWizardResult {
  draft: Draft;
  step: number;
  error: string;
  published: boolean;

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

  saveDraft: () => void;
  publish: () => void;

  priorReportOptions: { value: string; label: string }[];

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
}

type DraftListKey = 'tasks' | 'risks' | 'priorities';

/**
 * Owns the in-progress report draft plus all wizard navigation/import state.
 * Ported from design-source/original-dashboard.dc.html's Component class
 * (script block lines 508-792) -- specifically the wizardStep/draft/
 * wizardError/wizardPublished/importSel slice of state and the methods that
 * operate on it (lines 521-604), plus the derived import-candidate values
 * from renderVals() (lines 688-699).
 */
export function useWizard(reports: Report[], initialReport: Report | null, options: UseWizardOptions): UseWizardResult {
  const [draft, setDraft] = useState<Draft>(() => initialReport ?? blankDraft());
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(false);
  const [importSel, setImportSel] = useState<ImportSelState>(blankImportSel);

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
  function addTask() {
    addDraftItem('tasks', () => ({ id: uid('t'), client: '', task: '', status: 'In Progress', deadline: '' }));
  }
  function updateTask<F extends keyof Task>(id: string, field: F, value: Task[F]) {
    updateDraftItem('tasks', id, field, value);
  }
  function removeTask(id: string) {
    removeDraftItem('tasks', id);
  }

  // ---- risks (line 564-566) ----
  function addRisk() {
    addDraftItem('risks', () => ({ id: uid('rk'), client: '', severity: 'At Risk', description: '', nextStep: '' }));
  }
  function updateRisk<F extends keyof Risk>(id: string, field: F, value: Risk[F]) {
    updateDraftItem('risks', id, field, value);
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
    const err = validateStep(step, draft);
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
  function saveDraft() {
    const id = draft.id || uid('r');
    const now = nowDate();
    const report = {
      ...draft,
      id,
      status: 'Draft',
      updatedAt: now,
      createdAt: draft.createdAt || now,
    } as Report;
    options.onSaveDraft(report);
  }

  /**
   * Sane rewrite of the prototype's string-comparison step-resolution
   * (`err === validateStep(1) ? 1 : err === validateStep(2) ? 2 : 5`,
   * line 549) -- identical behavior: validate steps 1, 2, 5 in order,
   * short-circuiting exactly like the original `||` chain (an empty-string
   * error is falsy), and jump to whichever step produced the first error.
   */
  function publish() {
    const err1 = validateStep(1, draft);
    const err2 = err1 ? '' : validateStep(2, draft);
    const err5 = err1 || err2 ? '' : validateStep(5, draft);
    const err = err1 || err2 || err5;
    if (err) {
      setError(err);
      setStep(err1 ? 1 : err2 ? 2 : 5);
      return;
    }
    const id = draft.id || uid('r');
    const now = nowDate();
    const report = {
      ...draft,
      id,
      status: 'Final',
      updatedAt: now,
      createdAt: draft.createdAt || now,
    } as Report;
    setDraft((d) => ({ ...d, id }));
    setPublished(true);
    options.onPublish(report);
  }

  // ---- import machinery (lines 576-604, derived candidates 688-699) ----
  const priorReports = [...reports].filter((r) => r.id !== draft.id).sort((a, b) => b.weekEnd.localeCompare(a.weekEnd));
  const priorReportOptions = priorReports.map((r) => ({
    value: r.id,
    label: fmtWeekLabel(r.weekStart, r.weekEnd) + ' — ' + r.status,
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
    const newTasks: Task[] = chosen.map((t) => ({ id: uid('t'), client: t.client, task: t.task, status: t.status, deadline: t.deadline }));
    setDraft((d) => ({ ...d, tasks: [...d.tasks, ...newTasks] }));
    setImportSel((s) => ({ ...s, taskChecked: {} }));
  }

  function importSelectedRisks() {
    if (!riskSrc) return;
    const candidates = riskSrc.risks.filter((rk) => !draft.risks.some((dr) => dr.client === rk.client && dr.description === rk.description));
    const chosen = candidates.filter((rk) => importSel.riskChecked[rk.id]);
    if (!chosen.length) return;
    const newRisks: Risk[] = chosen.map((rk) => ({ id: uid('rk'), client: rk.client, severity: rk.severity, description: rk.description, nextStep: rk.nextStep }));
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

  return {
    draft,
    step,
    error,
    published,

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
  };
}
