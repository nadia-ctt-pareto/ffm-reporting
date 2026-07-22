'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { resolveLoadError } from './load-error';
import type { TeamMember } from '../types';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * WP1: the TeamMember entity's sibling of useProjects.ts -- identical
 * optimistic-update pattern, over `getReportsRepository().getTeamMembers()`.
 * Still only ever goes through `getReportsRepository()`, never a concrete
 * repository class. Mirrors useProjects.ts's failure-resilience contract
 * exactly -- see that file's doc comments for `loadError`/`mutationError`/
 * the resolve-or-rollback-and-reject mutation contract/`enabled`.
 */
export interface UseTeamMembersOptions {
  enabled?: boolean;
}

export interface UseTeamMembersResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  members: TeamMember[] | null;
  loadError: string | null;
  mutationError: string | null;
  /** Optimistic local update + persistence -- resolves on success, rejects (after rollback) on failure. */
  upsertTeamMember: (member: TeamMember) => Promise<void>;
  /** Renames EXACTLY a member's `name`. Same optimistic + rollback + `mutationError` contract as `upsertTeamMember`. Mirrors useProjects.ts's `renameProject` -- see that hook's own doc comment. */
  renameTeamMember: (id: string, name: string) => Promise<void>;
  /**
   * Deletes a team member. Deliberately NOT optimistic (unlike
   * `upsertTeamMember`/`renameTeamMember`) -- mirrors `useProjects.ts`'s
   * `deleteProject` doc comment verbatim in spirit: a delete is terminal (no
   * "rolled-back-but-still-there" state that reads correctly to a
   * consumer), so `members` only loses the row AFTER the repository call
   * actually succeeds. Unlike `deleteProject`, there is no route-redirect
   * this specifically prevents (Team has no per-member detail route to
   * navigate away from -- see `components/team/TeamManager.tsx`'s header
   * comment) -- the non-optimistic shape is kept anyway for the same
   * underlying reason: a failed delete should leave the row visibly present
   * with a visible error, never a flash of "removed" that silently pops
   * back once the rejection resolves.
   */
  deleteTeamMember: (id: string) => Promise<void>;
}

export function useTeamMembers(options?: UseTeamMembersOptions): UseTeamMembersResult {
  const enabled = options?.enabled ?? true;
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getReportsRepository()
      .getTeamMembers()
      .then((all) => {
        if (cancelled) return;
        setMembers(all);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Post-review fix (SHOULD-FIX 11) -- see useReports.ts's identical catch for the full rationale.
        const message = resolveLoadError(err, 'Failed to load team members.');
        if (message !== null) setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /** Post-review fix (SHOULD-FIX 13) -- see useReports.ts's `rollback` doc comment for the full rationale (identical here, mirrored for team members). */
  const rollback = useCallback(async () => {
    try {
      await getReportsRepository().whenIdle();
      const all = await getReportsRepository().getTeamMembers();
      setMembers(all);
    } catch {
      // Refetch failed too -- leave `members` alone rather than blank the screen.
    }
  }, []);

  const upsertTeamMember = useCallback(
    async (member: TeamMember) => {
      setMembers((prev) => {
        if (!prev) return prev;
        const exists = prev.some((m) => m.id === member.id);
        return exists ? prev.map((m) => (m.id === member.id ? member : m)) : [...prev, member];
      });
      try {
        await getReportsRepository().upsertTeamMember(member);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the team member.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /**
   * Optimistically renames `id`'s `name` in local state before the write
   * resolves (matching `upsertTeamMember`'s pattern), rolling back to server
   * truth on failure. Never touches any other field of the matching member.
   */
  const renameTeamMember = useCallback(
    async (id: string, name: string) => {
      setMembers((prev) => (prev ? prev.map((m) => (m.id === id ? { ...m, name } : m)) : prev));
      try {
        const renamed = await getReportsRepository().renameTeamMember(id, name);
        setMembers((prev) => (prev ? prev.map((m) => (m.id === id ? renamed : m)) : prev));
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to rename the team member.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /** NON-optimistic -- see this hook's own `deleteTeamMember` doc comment above (the `UseTeamMembersResult` interface) for why. */
  const deleteTeamMember = useCallback(async (id: string) => {
    try {
      await getReportsRepository().deleteTeamMember(id);
      setMembers((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
      setMutationError(null);
    } catch (err) {
      setMutationError(errorMessage(err, 'Failed to delete the team member.'));
      throw err;
    }
  }, []);

  return { members, loadError, mutationError, upsertTeamMember, renameTeamMember, deleteTeamMember };
}
