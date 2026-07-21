'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { resolveLoadError } from './load-error';
import type { Project } from '../types';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Phase 6a: the Project entity's sibling of useReports.ts -- identical
 * optimistic-update pattern, over `getReportsRepository().getProjects()`.
 * Still only ever goes through `getReportsRepository()`, never a concrete
 * repository class.
 *
 * Phase 7b: mirrors useReports.ts's failure-resilience contract exactly --
 * see that file's doc comments for `loadError`/`mutationError`/the
 * resolve-or-rollback-and-reject mutation contract/`enabled`.
 */
export interface UseProjectsOptions {
  enabled?: boolean;
}

export interface UseProjectsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  projects: Project[] | null;
  loadError: string | null;
  mutationError: string | null;
  /** Optimistic local update + persistence -- resolves on success, rejects (after rollback) on failure. */
  upsertProject: (project: Project) => Promise<void>;
  /** Phase 8c: renames EXACTLY a project's `name`. Same optimistic + rollback + `mutationError` contract as `upsertProject`. See CLAUDE.md's "THE CRUX -- rename safety". */
  renameProject: (id: string, name: string) => Promise<void>;
  /**
   * Phase 8c: deletes a project. Deliberately NOT optimistic (unlike
   * `upsertProject`/`renameProject`) -- see this hook's own `deleteProject`
   * doc comment for why a delete is different: a delete is terminal (no
   * "rolled-back-but-still-there" state that reads correctly to a
   * consumer), and `ProjectDetailScreen`'s route wrapper redirects away the
   * instant `id` disappears from `projects` -- an optimistic removal would
   * fire that redirect BEFORE the write is confirmed, unmounting the
   * screen while the request is still in flight and silently swallowing a
   * later failure (post-review SHOULD-FIX 2, verified live: a forced
   * failure bounced the user to `/projects` with zero visible error, even
   * though the project itself was never actually deleted).
   */
  deleteProject: (id: string) => Promise<void>;
}

export function useProjects(options?: UseProjectsOptions): UseProjectsResult {
  const enabled = options?.enabled ?? true;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getReportsRepository()
      .getProjects()
      .then((all) => {
        if (cancelled) return;
        setProjects(all);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Post-review fix (SHOULD-FIX 11) -- see useReports.ts's identical catch for the full rationale.
        const message = resolveLoadError(err, 'Failed to load projects.');
        if (message !== null) setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /** Post-review fix (SHOULD-FIX 13) -- see useReports.ts's `rollback` doc comment for the full rationale (identical here, mirrored for projects). */
  const rollback = useCallback(async () => {
    try {
      await getReportsRepository().whenIdle();
      const all = await getReportsRepository().getProjects();
      setProjects(all);
    } catch {
      // Refetch failed too -- leave `projects` alone rather than blank the screen.
    }
  }, []);

  const upsertProject = useCallback(
    async (project: Project) => {
      setProjects((prev) => {
        if (!prev) return prev;
        const exists = prev.some((p) => p.id === project.id);
        return exists ? prev.map((p) => (p.id === project.id ? project : p)) : [...prev, project];
      });
      try {
        await getReportsRepository().upsertProject(project);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the project.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /**
   * Phase 8c: optimistically renames `id`'s `name` in local state before
   * the write resolves (matching `upsertProject`'s pattern), rolling back
   * to server truth on failure. Never touches any other field of the
   * matching project, and never reaches into `reports`/task/risk state at
   * all -- see CLAUDE.md's "THE CRUX -- rename safety".
   */
  const renameProject = useCallback(
    async (id: string, name: string) => {
      setProjects((prev) => (prev ? prev.map((p) => (p.id === id ? { ...p, name } : p)) : prev));
      try {
        const renamed = await getReportsRepository().renameProject(id, name);
        setProjects((prev) => (prev ? prev.map((p) => (p.id === id ? renamed : p)) : prev));
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to rename the project.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /**
   * Post-review SHOULD-FIX 2 (Phase 8c): NON-optimistic, unlike every other
   * mutation in this file -- `id` is only removed from `projects` AFTER the
   * repository call actually succeeds, never before. This matters
   * specifically because `app/(shell)/projects/[id]/page.tsx` derives
   * `notFound` from `projects` and redirects to `/projects` the instant its
   * id disappears from that list; an optimistic removal (the pattern every
   * OTHER mutation here uses) would fire that redirect while the delete
   * request was still in flight, unmounting `ProjectDetailScreen` before
   * the write resolved. On success this is harmless (the redirect was
   * going to happen anyway) but on FAILURE it was a real bug: the
   * (now-unmounted) screen's own catch block never got to render
   * `deleteError`, so a rejected delete (e.g. "still referenced" surfacing
   * late, or a transient 5xx) silently bounced the user back to `/projects`
   * with no visible error at all -- even though the project was never
   * actually deleted (confirmed via `rollback()`'s own re-fetch, which the
   * user never saw happen). Doing the state update only after a confirmed
   * success removes the need for `rollback()` here entirely -- there is
   * nothing to roll back if nothing was ever optimistically changed.
   */
  const deleteProject = useCallback(async (id: string) => {
    try {
      await getReportsRepository().deleteProject(id);
      setProjects((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      setMutationError(null);
    } catch (err) {
      setMutationError(errorMessage(err, 'Failed to delete the project.'));
      throw err;
    }
  }, []);

  return { projects, loadError, mutationError, upsertProject, renameProject, deleteProject };
}
