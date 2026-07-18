// Phase 6a: pure helpers for the Project entity. No storage/React here --
// mirrors the style of lib/report-utils.ts / lib/aggregate.ts.

import { uid } from './format';
import type { AnyReport, Project, Risk, Task } from './types';

/** Lowercase, non-alphanumeric runs -> single '-', leading/trailing '-' trimmed. May legitimately return `''` for a name with no letters/digits at all (e.g. `"..."`, an emoji-only string) -- see `isBlankProjectName` below, the primary guard against that. */
function rawSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * True when `name` has no letters/digits at all, i.e. would slugify to
 * `''`. The PRIMARY guard against that is at the UI layer
 * (`CsvImportSection.tsx`'s `resolveNewProject`, called BEFORE
 * `slugifyProjectName` below, so it can show a visible validation error
 * instead of silently falling back) -- this predicate is what that check
 * calls. Exported separately from `slugifyProjectName` (rather than having
 * callers check `slugifyProjectName(name) === ''`) specifically so it can
 * detect the blank case even though `slugifyProjectName` itself never
 * returns `''` (see its own doc comment) -- checking the OUTPUT of the
 * fallback-having function could never observe the case the fallback just
 * papered over.
 */
export function isBlankProjectName(name: string): boolean {
  return rawSlug(name) === '';
}

/**
 * Used only when *creating* new projects at import time (Phase 6b) --
 * never called from the wizard (Phase 6a has no project-creation UI).
 * Deliberately NOT used by seedProjects() below, so the app seed and the
 * SQL seed (supabase/migrations/20260717000001_initial_schema.sql) can
 * never drift from each other.
 *
 * Never returns `''`: a name with no letters/digits at all would otherwise
 * slugify to the empty string, which collides with the house bucket's own
 * `''`/`null` key (`sameProjectBucket`, lib/report-utils.ts) and crashes
 * Radix's `Select` (which rejects an empty-string item value) the next
 * time `/settings` renders a project list containing it. Callers are
 * expected to reject such a name with `isBlankProjectName` BEFORE ever
 * calling this (see `CsvImportSection.tsx`'s `resolveNewProject`) -- this
 * `uid()` fallback is defense in depth, not the primary guard, so a bug in
 * a future caller can never persist a broken project.
 */
export function slugifyProjectName(name: string): string {
  return rawSlug(name) || uid('project');
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
