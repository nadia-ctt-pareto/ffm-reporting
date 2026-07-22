'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import { nowDate } from '../format';
import { resolveLoadError } from './load-error';
import type { Report } from '../types';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export interface UseReportsOptions {
  /**
   * Phase 7b: additive, defaults `true`. Set `false` to skip the initial
   * `getAll()` fetch entirely -- for the tokened `/reports/[id]/present`
   * route (Phase 7b M3), which resolves its report via a bare anon client
   * + `get_shared_report` instead, and would otherwise fire a fetch that's
   * guaranteed to 401 for an anonymous visitor (or, worse, silently
   * succeed against the wrong report via a signed-in viewer's OWN session
   * -- see the present route's "session-fallback attack" verification).
   */
  enabled?: boolean;
}

export interface UseReportsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  reports: Report[] | null;
  /** Phase 7b: set if the initial `getAll()` load itself failed (e.g. Supabase unreachable). `reports` stays `null` in that case -- there is no optimistic data to fall back to for a load that never succeeded once. */
  loadError: string | null;
  /** Phase 7b: set by the most recent mutation that failed; cleared by the next one that succeeds. Independent of `loadError`. */
  mutationError: string | null;
  /**
   * Optimistic local update + persistence. Phase 7b: now returns a
   * `Promise<void>` that RESOLVES on success and REJECTS on failure (after
   * rolling the optimistic update back to server truth and setting
   * `mutationError`) -- callers that need to gate UI on the outcome (the
   * wizard's publish/saveDraft) must `await` it; callers that don't
   * (fire-and-forget autosave) can ignore the returned promise exactly as
   * before -- a function returning `Promise<void>` remains assignable to
   * any existing `=> void`-typed prop.
   */
  upsertReport: (report: Report) => Promise<void>;
  /**
   * Phase 6b: batch sibling of `upsertReport` -- ONE repository write for
   * the whole array (see `ReportsRepository.upsertMany`'s doc comment for
   * why N separate `upsertReport` calls is NOT safe for a same-tick batch).
   * Same Phase 7b resolve/reject contract as `upsertReport`.
   */
  upsertMany: (reports: Report[]) => Promise<void>;
  /** Shallow-merges `patch` (plus a fresh `updatedAt`) into the report with `id`. Same Phase 7b resolve/reject contract as `upsertReport`. */
  updateReportFields: (id: string, patch: Partial<Report>) => Promise<void>;
  /**
   * Phase 8d (report delete): deletes the report with `id`. Deliberately NOT optimistic (unlike
   * every mutation above) -- see this hook's own `deleteReport`
   * implementation for the full rationale (mirrors `useProjects.ts`'s
   * `deleteProject`, including its Phase 8c SHOULD-FIX 2 precedent).
   */
  deleteReport: (id: string) => Promise<void>;
}

export function useReports(options?: UseReportsOptions): UseReportsResult {
  const enabled = options?.enabled ?? true;
  const [reports, setReports] = useState<Report[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getReportsRepository()
      .getAll()
      .then((all) => {
        if (cancelled) return;
        setReports(all);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Post-review fix (SHOULD-FIX 11): a 401 (session expired in a
        // stale tab) redirects straight to /login instead of leaving
        // `reports` null forever with an unread `loadError` -- see
        // lib/hooks/load-error.ts's header comment.
        const message = resolveLoadError(err, 'Failed to load reports.');
        if (message !== null) setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /**
   * Rolls the optimistic update back by re-fetching server truth. If the
   * refetch ITSELF fails (e.g. offline), `reports` is deliberately left as
   * the last known-good state rather than cleared -- clearing it would
   * blank the whole screen on top of an already-failed mutation.
   *
   * Post-review fix (SHOULD-FIX 13): awaits `whenIdle()` FIRST -- without
   * it, two rapid mutations (A then B) could race: A's write fails ->
   * `rollback()` fires its `getAll()` while B's write is STILL queued/in
   * flight -> the refetch returns server truth from BEFORE B landed ->
   * `setReports(server)` discards B's optimistic UI state even though B's
   * own write goes on to succeed a moment later. This is the exact
   * same-client interleaving class `HttpReportsRepository`'s write queue
   * exists to prevent (see that file's header comment), reintroduced here
   * on the READ side. `whenIdle()` (no-op for `LocalStorageReportsRepository`,
   * see that class) makes this refetch wait for every write queued so far
   * to settle before it runs.
   */
  const rollback = useCallback(async () => {
    try {
      await getReportsRepository().whenIdle();
      const all = await getReportsRepository().getAll();
      setReports(all);
    } catch {
      // Refetch failed too -- leave `reports` alone (see doc comment above).
    }
  }, []);

  const upsertReport = useCallback(
    async (report: Report) => {
      setReports((prev) => {
        if (!prev) return prev;
        const exists = prev.some((r) => r.id === report.id);
        return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
      });
      try {
        await getReportsRepository().upsert(report);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the report.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  const upsertMany = useCallback(
    async (reports: Report[]) => {
      if (reports.length === 0) return;
      setReports((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of reports) byId.set(r.id, r);
        return [...byId.values()];
      });
      try {
        await getReportsRepository().upsertMany(reports);
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save the reports.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  const updateReportFields = useCallback(
    async (id: string, patch: Partial<Report>) => {
      const fullPatch: Partial<Report> = { ...patch, updatedAt: nowDate() };
      setReports((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...fullPatch } : r)) : prev));
      try {
        const result = await getReportsRepository().update(id, fullPatch);
        // Post-review fix (SHOULD-FIX 14): `update()` returns `null` when
        // the id doesn't exist server-side (deleted elsewhere, or a stale
        // client route for a report that only ever lived in a pre-cutover
        // browser's localStorage) -- this used to be treated identically to
        // success (`setMutationError(null)`), so the report screen kept
        // showing "Changes save automatically." for a write that hit
        // nothing. A `null` result is now a REJECTION, routed through the
        // same catch block below (rollback + mutationError) as any other
        // failure.
        if (result === null) {
          throw new Error('This report no longer exists -- it may have been deleted elsewhere.');
        }
        // Applying the server's own returned object (rather than trusting
        // only the optimistic client-side patch above) keeps `reports` in
        // sync with whatever the server actually normalized/stamped (e.g.
        // Supabase mode's full-precision server-stamped `updatedAt`, which
        // differs from this hook's client-side `nowDate()` guess).
        setReports((prev) => (prev ? prev.map((r) => (r.id === id ? (result as Report) : r)) : prev));
        setMutationError(null);
      } catch (err) {
        setMutationError(errorMessage(err, 'Failed to save changes.'));
        await rollback();
        throw err;
      }
    },
    [rollback]
  );

  /**
   * Phase 8d (report delete): deliberately NOT optimistic, unlike `upsertReport`/`upsertMany`/
   * `updateReportFields` above -- mirrors `useProjects.ts`'s `deleteProject`,
   * including its own rationale verbatim: `app/(shell)/reports/[id]/page.tsx`
   * derives `notFound` from `reports` and `router.replace`s away to
   * `/reports` the instant an id disappears from that list. An optimistic
   * removal (the pattern every OTHER mutation in this hook uses) would fire
   * that redirect WHILE the DELETE request is still in flight, unmounting
   * `ReportScreen` -- and the confirm dialog's own error surface along with
   * it -- before a later rejection could ever render there. That is the
   * exact Phase 8c SHOULD-FIX 2 bug class (see `useProjects.ts`'s
   * `deleteProject` for the live-verified failure mode this avoids: a
   * forced delete failure silently bounced the screen to the list with zero
   * visible error, even though nothing was actually deleted). `reports`
   * only loses `id` AFTER the repository call actually succeeds; on
   * failure, `reports` was never touched, so there is nothing to roll back
   * and no `rollback()` call here at all -- same reasoning as
   * `useProjects.ts`'s `deleteProject`.
   */
  const deleteReport = useCallback(async (id: string) => {
    try {
      await getReportsRepository().deleteReport(id);
      setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      setMutationError(null);
    } catch (err) {
      setMutationError(errorMessage(err, 'Failed to delete the report.'));
      throw err;
    }
  }, []);

  return { reports, loadError, mutationError, upsertReport, upsertMany, updateReportFields, deleteReport };
}
