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

  return { projects, loadError, mutationError, upsertProject };
}
