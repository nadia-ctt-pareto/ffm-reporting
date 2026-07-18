// Phase 4: pure aggregation of a week's daily reports into an in-progress
// weekly Draft, powering the weekly wizard's "Import This Week's Daily
// Reports" action (StepBasics, wired through useWizard.importWeekDailies).
// Nothing here touches storage or React state -- the caller (useWizard)
// is responsible for calling setDraft(d => aggregateDailiesIntoDraft(...)).
//
// Dedup predicates deliberately reuse the exact (client, task) /
// (client, description) / (text) keys already used by useWizard's
// carry-forward Import panels (steps 2/4/5) -- same "does this already
// exist in the draft" semantics, just fed a whole week of dailies (in date
// order) instead of a single prior report.

import { uid } from './format';
import type { DailyReport, Draft, Priority, Risk, Task } from './types';

function taskKey(t: Pick<Task, 'client' | 'task'>): string {
  return `${t.client}::${t.task}`;
}

function riskKey(rk: Pick<Risk, 'client' | 'description'>): string {
  return `${rk.client}::${rk.description}`;
}

/**
 * Merges `dailies` (that week's daily reports) into `draft` (the weekly
 * draft being edited), returning a NEW Draft (never mutates its inputs):
 *
 * - **tasks**: deduped by (client, task); when the same pair appears on
 *   multiple days, the LATEST day's version (status/deadline) wins. Skips
 *   any pair already present in `draft.tasks`.
 * - **risks**: deduped by (client, description), latest day's version
 *   (severity/nextStep) wins. Skips any pair already present in `draft.risks`.
 * - **priorities**: deduped by exact `text`. Skips any text already present
 *   in `draft.priorities`.
 * - **touchpoints**: `calls`/`emails`/`escalations` are SUMMED across every
 *   daily (added on top of whatever `draft.touchpoints` already had);
 *   `narrative` is every non-empty narrative (draft's own first, if any)
 *   joined with `\n`.
 * - **win**: the LATEST day (scanning newest-first) with a non-empty win
 *   (any of stat/label/narrative set) -- but ONLY if `draft.win` is
 *   currently empty. A win the user already typed into the draft is never
 *   clobbered by importing.
 */
export function aggregateDailiesIntoDraft(dailies: DailyReport[], draft: Draft): Draft {
  const ordered = [...dailies].sort((a, b) => a.date.localeCompare(b.date));

  const taskByKey = new Map<string, Task>();
  for (const daily of ordered) {
    for (const t of daily.tasks) taskByKey.set(taskKey(t), t);
  }
  // TODO(6b): this drops `t.projectId` -- harmless today (ensureProjectIds
  // re-derives it next load from `client === project.name`), but becomes
  // silent data loss the moment an imported daily's `client` string can
  // diverge from its project's `name`. Carry `projectId: t.projectId`
  // through here once Phase 6b's CSV importer lands.
  const newTasks: Task[] = [...taskByKey.values()]
    .filter((t) => !draft.tasks.some((dt) => dt.client === t.client && dt.task === t.task))
    .map((t) => ({ id: uid('t'), client: t.client, task: t.task, status: t.status, deadline: t.deadline }));

  const riskByKey = new Map<string, Risk>();
  for (const daily of ordered) {
    for (const rk of daily.risks) riskByKey.set(riskKey(rk), rk);
  }
  // TODO(6b): see the identical note above newTasks -- drops `rk.projectId`,
  // harmless today, becomes silent data loss once an imported daily risk's
  // `client` can diverge from its project's `name`.
  const newRisks: Risk[] = [...riskByKey.values()]
    .filter((rk) => !draft.risks.some((dr) => dr.client === rk.client && dr.description === rk.description))
    .map((rk) => ({ id: uid('rk'), client: rk.client, severity: rk.severity, description: rk.description, nextStep: rk.nextStep }));

  const newPriorities: Priority[] = [];
  const seenText = new Set(draft.priorities.map((p) => p.text));
  for (const daily of ordered) {
    for (const p of daily.priorities) {
      if (seenText.has(p.text)) continue;
      seenText.add(p.text);
      newPriorities.push({ id: uid('p'), text: p.text });
    }
  }

  const touchpoints = {
    calls: draft.touchpoints.calls + ordered.reduce((sum, d) => sum + d.touchpoints.calls, 0),
    emails: draft.touchpoints.emails + ordered.reduce((sum, d) => sum + d.touchpoints.emails, 0),
    escalations: draft.touchpoints.escalations + ordered.reduce((sum, d) => sum + d.touchpoints.escalations, 0),
    narrative: [draft.touchpoints.narrative, ...ordered.map((d) => d.touchpoints.narrative)].filter(Boolean).join('\n'),
  };

  let win = draft.win;
  const draftWinEmpty = !draft.win.stat && !draft.win.label && !draft.win.narrative;
  if (draftWinEmpty) {
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const candidate = ordered[i].win;
      if (candidate.stat || candidate.label || candidate.narrative) {
        // Copy, don't alias -- the returned draft (and whatever it's later
        // published into) must never share a live object reference with
        // the source daily report still sitting in the dailies list.
        win = { ...candidate };
        break;
      }
    }
  }

  return {
    ...draft,
    tasks: [...draft.tasks, ...newTasks],
    risks: [...draft.risks, ...newRisks],
    priorities: [...draft.priorities, ...newPriorities],
    touchpoints,
    win,
  };
}
