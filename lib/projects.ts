// Phase 6a: pure helpers for the Project entity. No storage/React here --
// mirrors the style of lib/report-utils.ts / lib/aggregate.ts.

import type { AnyReport, Project, Risk, Task } from './types';

/**
 * Lowercase, non-alphanumeric runs -> single '-', leading/trailing '-'
 * trimmed. Used only when *creating* new projects at import time (Phase
 * 6b) -- never called from the wizard (Phase 6a has no project-creation
 * UI). Deliberately NOT used by seedProjects() below, so the app seed and
 * the SQL seed (supabase/migrations/20260717000001_initial_schema.sql) can
 * never drift from each other.
 */
export function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Exact-name match only -- never fuzzy. Returns the matching Project's `id`, or undefined if no project's `name` exactly equals `name`. */
export function projectIdForClientName(name: string, projects: Project[]): string | undefined {
  return projects.find((p) => p.name === name)?.id;
}

function stampList<T extends Task | Risk>(items: T[], projects: Project[]): { items: T[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (item.projectId != null) return item;
    const id = projectIdForClientName(item.client, projects);
    if (id === undefined) return item;
    changed = true;
    return { ...item, projectId: id };
  });
  return changed ? { items: next, changed } : { items, changed };
}

/**
 * Lazy backfill (called from `LocalStorageReportsRepository.loadAll()`,
 * against whichever payload it resolved -- an existing v2 read, a freshly
 * migrated v1 payload, or a freshly reseeded one): for every task/risk
 * whose `client` exactly equals a project's `name` and whose `projectId` is
 * unset, stamps that project's `id`. Exact-name matches only -- never
 * auto-creates projects from free-text client strings (a typo would mint a
 * junk match); unknown client names simply stay unstamped, which is today's
 * semantics. Pure function (never mutates `reports`); the caller decides
 * whether/when to persist -- `changed` is what lets it skip a write when
 * nothing needed stamping (no write-per-read on the warm path). Every
 * unchanged report keeps its original object reference (only reports that
 * actually needed a stamp get a new one), though the outer array returned
 * is always a fresh one from `.map()`.
 */
export function ensureProjectIds(reports: AnyReport[], projects: Project[]): { reports: AnyReport[]; changed: boolean } {
  let changed = false;
  const next = reports.map((r) => {
    const tasks = stampList(r.tasks, projects);
    const risks = stampList(r.risks, projects);
    if (!tasks.changed && !risks.changed) return r;
    changed = true;
    return { ...r, tasks: tasks.items, risks: risks.items } as AnyReport;
  });
  return { reports: next, changed };
}
