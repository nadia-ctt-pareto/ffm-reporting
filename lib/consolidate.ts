// Phase 6b: pure sanitization pre-passes for the `/consolidate` screen
// (components/consolidate/ConsolidateScreen.tsx). No storage/React here --
// mirrors the style of lib/aggregate.ts / lib/report-utils.ts. The screen
// composes, in order: check-filter (which sources the user included) ->
// `normalizeClientNames` -> `stripEmptyItems` -> `aggregateReportsIntoDraft`
// (lib/aggregate.ts) against a blank weekly draft anchored to the chosen
// week. Every function here returns NEW objects -- `sources` (and every
// report/task/risk inside them) is never mutated, so the underlying reports
// already persisted in the repository are never touched by consolidation,
// only read from.

import type { AnyReport, Project, Risk, Task } from './types';

/** A client-name string across `sources`' tasks/risks matched (after trim + casefold) to a known Project's canonical `name`. */
export interface ClientNameSuggestion {
  /** The distinct `client` string as it actually appears in the sources. */
  from: string;
  /** The exact `Project.name` it matches once both are trimmed + casefolded. */
  to: string;
}

/** Every DISTINCT `client` string across every task/risk in `sources`, in order of first appearance. */
function distinctClientNames(sources: AnyReport[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const source of sources) {
    for (const t of source.tasks) {
      if (!seen.has(t.client)) {
        seen.add(t.client);
        names.push(t.client);
      }
    }
    for (const rk of source.risks) {
      if (!seen.has(rk.client)) {
        seen.add(rk.client);
        names.push(rk.client);
      }
    }
  }
  return names;
}

/**
 * Every distinct client string that is NOT already an exact match for a
 * known project's name, but IS an exact match once both are trimmed and
 * casefolded -- a suggested rename to the canonical `Project.name`.
 * Deliberately exact-after-normalize only, never fuzzy (see the plan's
 * "Client-name normalization" -- no Levenshtein/fuzzy matching). Skips any
 * name that's already an exact match (nothing to suggest there).
 */
export function suggestClientNameRenames(sources: AnyReport[], projects: Project[]): ClientNameSuggestion[] {
  const suggestions: ClientNameSuggestion[] = [];
  for (const name of distinctClientNames(sources)) {
    if (projects.some((p) => p.name === name)) continue; // already exact -- nothing to suggest
    const match = projects.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (match) suggestions.push({ from: name, to: match.name });
  }
  return suggestions;
}

/**
 * Rewrites `client` only -- `projectId` is left untouched here, so it can
 * be stale relative to the NEW `client` string for one cycle. Harmless in
 * practice: `ensureProjectIds` (lib/projects.ts) re-derives `projectId` by
 * exact `client === project.name` match on every repository read, so once
 * this merged output is persisted (via the wizard, after further editing)
 * the next load re-stamps it correctly -- exactly the same lazy-backfill
 * path every hand-authored report already goes through.
 */
function renameClientIn<T extends Task | Risk>(items: T[], renames: Map<string, string>): T[] {
  let changed = false;
  const next = items.map((item) => {
    const to = renames.get(item.client);
    if (to === undefined) return item;
    changed = true;
    return { ...item, client: to };
  });
  return changed ? next : items;
}

/**
 * Applies `acceptedRenames` (a subset of `suggestClientNameRenames`'s output
 * the user checked) to `sources`' tasks/risks -- returns NEW report objects;
 * `sources` and everything inside them are never mutated, and a source that
 * carries none of the accepted renames keeps its exact original object
 * reference. `projects` re-validates that every accepted rename's `to` is
 * still a real project name (defensive -- guards against a stale
 * suggestion if `projects` changed between when it was computed and when
 * it's applied). This renames the MERGED/consolidated output only --
 * sources themselves are never persisted back with the rename applied (see
 * ConsolidateScreen's doc comment: "sources are never touched").
 */
export function normalizeClientNames(sources: AnyReport[], projects: Project[], acceptedRenames: ClientNameSuggestion[]): AnyReport[] {
  const validProjectNames = new Set(projects.map((p) => p.name));
  const applied = acceptedRenames.filter((r) => validProjectNames.has(r.to));
  if (applied.length === 0) return sources;
  const renames = new Map(applied.map((r) => [r.from, r.to]));
  return sources.map((source) => {
    const tasks = renameClientIn(source.tasks, renames);
    const risks = renameClientIn(source.risks, renames);
    if (tasks === source.tasks && risks === source.risks) return source;
    return { ...source, tasks, risks } as AnyReport;
  });
}

/** One task/risk/priority excluded by `stripEmptyItems` because its content field was blank. `client` is omitted for priorities (they have none). */
export interface SkippedItem {
  type: 'task' | 'risk' | 'priority';
  client?: string;
}

export interface StripEmptyResult {
  report: AnyReport;
  skipped: SkippedItem[];
}

/**
 * Drops tasks with a blank (whitespace-only counts as blank) `task`, risks
 * with a blank `description`, and priorities with a blank `text` -- returns
 * a NEW report object (never mutates `source`) plus every item it dropped,
 * so the screen can list them ("N empty rows skipped"). A source with
 * nothing to strip returns a `report` that is a fresh shallow copy (per the
 * repo's usual "always return a new object from a pure transform" style)
 * but with the exact same `tasks`/`risks`/`priorities` array references.
 */
export function stripEmptyItems(source: AnyReport): StripEmptyResult {
  const skipped: SkippedItem[] = [];

  const tasks = source.tasks.filter((t) => {
    if (t.task.trim() !== '') return true;
    skipped.push({ type: 'task', client: t.client });
    return false;
  });
  const risks = source.risks.filter((rk) => {
    if (rk.description.trim() !== '') return true;
    skipped.push({ type: 'risk', client: rk.client });
    return false;
  });
  const priorities = source.priorities.filter((p) => {
    if (p.text.trim() !== '') return true;
    skipped.push({ type: 'priority' });
    return false;
  });

  return { report: { ...source, tasks, risks, priorities } as AnyReport, skipped };
}
