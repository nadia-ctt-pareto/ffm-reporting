// Phase 7b (M4): one-time migration helper -- reads THIS BROWSER's
// localStorage data (Phase 1-6 seed data plus anything hand-authored while
// running in demo mode) so Settings' "Local Data Import" section can push it
// into Postgres via `POST /api/projects` (ensure-exists) then ONE
// `POST /api/reports` (`skipExisting: true`).
//
// Deliberately instantiates `LocalStorageReportsRepository` DIRECTLY -- the
// one documented exception to "UI code only ever calls
// getReportsRepository()" (see lib/data/reports-repository.ts's header
// comment and CLAUDE.md's "Non-negotiable constraints"): this file's whole
// job is reading localStorage as a migration SOURCE, not participating in
// the swappable-repository abstraction as a live data plane -- calling
// `getReportsRepository()` here would return whatever the factory picked for
// THIS session (in Supabase mode, already `HttpReportsRepository`), which is
// not what this needs at all. Instantiating `LocalStorageReportsRepository`
// directly also gets the v1->v2 migration and the Phase 6a `projectId`
// backfill "for free" -- exactly the same normalization a browser's own
// pre-cutover demo-mode reads already went through, so the export payload
// matches what that browser's UI was showing right up until the cutover.
//
// Never deletes/clears any local key -- same backup discipline as the v1 key
// (see LocalStorageReportsRepository's own header comment): a failed or
// partial import must never be able to destroy the only copy of this
// browser's data. Re-running this after a successful import is always safe
// for the same reason (nothing was ever deleted) and is exactly what
// `skipExisting` (the caller's job, not this file's) is for.
//
// Note: on a browser that has NEVER run in demo mode (only ever used
// Supabase mode), calling this the first time will SEED `ff.reports.v2`
// with the standard 7 weekly + 5 daily seed set (the same lazy-seed-on-first-
// read `LocalStorageReportsRepository.loadAll()` always does) as a side
// effect of reading it -- harmless: those ids (`r1..r7`/`d1..d5`) already
// exist in Postgres too (`supabase/seed.sql`), so the caller's
// `skipExisting: true` import reports them all as skipped, not duplicated.

import { LocalStorageReportsRepository } from './local-storage-reports-repository';
import type { AnyReport, Project } from '../types';

export interface LocalExport {
  projects: Project[];
  reports: AnyReport[];
}

/**
 * Reads this browser's localStorage reports + projects via a fresh,
 * throwaway `LocalStorageReportsRepository` instance (see header comment for
 * why NOT the app-wide `getReportsRepository()` singleton). Returns `null`
 * when there is no `localStorage` to read at all (`window === undefined`) --
 * this only ever runs client-side in practice (triggered by a button click),
 * but stays consistent with every other repository method's SSR guard.
 */
export async function readLocalExport(): Promise<LocalExport | null> {
  if (typeof window === 'undefined') return null;
  const repo = new LocalStorageReportsRepository();
  const [weeklies, dailies, projects] = await Promise.all([repo.getAll(), repo.getAllDaily(), repo.getProjects()]);
  return { projects, reports: [...weeklies, ...dailies] };
}
