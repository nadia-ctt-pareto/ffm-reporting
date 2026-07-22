'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { resolveLoadError } from './load-error';
import type { AssignedTask, AssignedTaskPatch } from '../types';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * WP3 (the access flip): the sibling of `useTeamMembers.ts` for
 * `AssignedTask[]` -- identical optimistic-update pattern, over
 * `getReportsRepository().getAssignedTasks()`/`updateTask()`. Demo mode
 * always resolves `tasks` to `[]` (see `LocalStorageReportsRepository
 * .getAssignedTasks`'s own doc comment) -- there is no assignee-visibility
 * gap for this hook to bridge there.
 *
 * Not yet consumed by any screen in this package -- WP3's scope is the
 * plumbing (repository/service/route/hook), not a new "My Assigned Tasks"
 * UI surface; a future package may render this list somewhere (e.g. `/tasks`
 * or Home).
 */
export interface UseAssignedTasksOptions {
  enabled?: boolean;
}

export interface UseAssignedTasksResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  tasks: AssignedTask[] | null;
  loadError: string | null;
  mutationError: string | null;
  /** Optimistic local patch + persistence -- resolves on success, rejects (after rollback) on failure. Only `status`/`deadline`/`completedAt` are ever sent -- see `AssignedTaskPatch`'s own doc comment (lib/types.ts). */
  updateTask: (taskId: string, patch: AssignedTaskPatch) => Promise<void>;
}

export function useAssignedTasks(options?: UseAssignedTasksOptions): UseAssignedTasksResult {
  const enabled = options?.enabled ?? true;
  const [tasks, setTasks] = useState<AssignedTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getReportsRepository()
      .getAssignedTasks()
      .then((all) => {
        if (cancelled) return;
        setTasks(all);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = resolveLoadError(err, 'Failed to load your assigned tasks.');
        if (message !== null) setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /** Mirrors every other hook's `rollback` (useReports.ts et al.) -- see that file's doc comment for the full same-client-write-race rationale `whenIdle()` closes. */
  const rollback = useCallback(async () => {
    try {
      await getReportsRepository().whenIdle();
      const all = await getReportsRepository().getAssignedTasks();
      setTasks(all);
    } catch {
      // Refetch failed too -- leave `tasks` alone rather than blank the screen.
    }
  }, []);

  const updateTask = useCallback(
    async (taskId: string, patch: AssignedTaskPatch) => {
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) : prev));
      try {
        const updated = await getReportsRepository().updateTask(taskId, patch);
        setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? updated : t)) : prev));
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to update the task.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  return { tasks, loadError, mutationError, updateTask };
}
