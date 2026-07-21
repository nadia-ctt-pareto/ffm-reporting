'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { readLocalExport } from '@/lib/data/local-import';
import { reportPeriodLabel } from '@/lib/report-utils';
import type { AnyReport, Project } from '@/lib/types';
import styles from './LocalDataImportSection.module.css';

interface ImportOutcome {
  imported: string[];
  skipped: string[];
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** `POST /api/projects` is insert-or-return-existing (`ensureProject`, lib/server/reports-service.ts) -- exactly "make sure this project exists," never a rename. Called BEFORE any report, since reports carry a `projectId` foreign key. */
async function ensureProjectExists(project: Project): Promise<void> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Failed to create project "${project.name}".`));
}

/**
 * ONE `POST /api/reports` for the WHOLE export (weeklies + dailies together,
 * unlike `CsvImportSection`'s two kind-specific batches -- see Trap #4/
 * CLAUDE.md's "upsertMany must be ONE POST -> ONE replace_reports call").
 * `skipExisting: true` is mandatory here, not optional (Trap #3): every
 * browser was seeded with the same ids (`r1..r7`/`d1..d5`), so importing
 * without it would collide across users the moment more than one browser
 * ever runs this. Calls `fetch` directly rather than going through
 * `getReportsRepository()`/`useReports()` -- those hooks' `upsertMany`
 * discards the server's `{imported, skipped}` breakdown (they just echo the
 * accepted reports back, matching `ReportsRepository.upsertMany`'s
 * interface), and that breakdown is the entire point of this screen (Trap
 * #3 requires the skipped ids to be visibly SHOWN, not silently dropped).
 */
async function importReports(reports: AnyReport[]): Promise<ImportOutcome> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reports, skipExisting: true }),
  });
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to import reports.'));
  return (await res.json()) as ImportOutcome;
}

/**
 * Settings section (Phase 7b M4), mounted only when `isSupabaseConfigured()`
 * (see SettingsScreen.tsx) -- see lib/data/local-import.ts's header comment
 * for the full migration rationale. One button: reads THIS browser's
 * localStorage export, ensures every project it references exists in
 * Postgres (sequential, one at a time, before any report), then commits
 * every report in ONE `POST /api/reports` call with `skipExisting: true`.
 * Safe to run more than once -- a second run reports everything as skipped
 * (nothing is ever deleted or overwritten locally or on the server).
 *
 * Follows `CsvImportSection`'s visual/UX pattern (section kicker, a primary
 * action button, an error/result panel below it) without reusing its parsing
 * machinery -- there is no file to parse here, just this browser's own
 * already-typed localStorage data.
 */
export function LocalDataImportSection() {
  const [status, setStatus] = useState<'idle' | 'reading' | 'importing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [reportById, setReportById] = useState<Map<string, AnyReport>>(new Map());

  async function handleImport() {
    setStatus('reading');
    setError(null);
    setOutcome(null);
    try {
      const local = await readLocalExport();
      if (!local || local.reports.length === 0) {
        setOutcome({ imported: [], skipped: [] });
        setStatus('done');
        return;
      }
      setReportById(new Map(local.reports.map((r) => [r.id, r])));
      setStatus('importing');
      for (const project of local.projects) {
        await ensureProjectExists(project);
      }
      const result = await importReports(local.reports);
      setOutcome(result);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import this browser's local data.");
      setStatus('error');
    }
  }

  const isBusy = status === 'reading' || status === 'importing';

  return (
    <section className={styles.section}>
      <div className={styles.sectionKicker}>Local Data Import</div>
      <p className={styles.sectionCopy}>
        If this browser has reports saved from before the move to a shared server, import them now. Every project they
        reference is created first, then every report is added -- any id that already exists on the server is skipped, not
        overwritten, so this is always safe to run more than once.
      </p>

      <div className={styles.templateRow}>
        <Button variant="primary" size="sm" onClick={handleImport} disabled={isBusy}>
          {status === 'reading' ? 'Reading local data…' : status === 'importing' ? 'Importing…' : "Import This Browser's Local Data"}
        </Button>
      </div>

      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div className={styles.resultPanel}>
          <div className={styles.resultHeading}>
            Imported {outcome.imported.length}, skipped {outcome.skipped.length}.
          </div>
          {outcome.imported.length === 0 && outcome.skipped.length === 0 ? (
            <p className={styles.sectionCopy}>Nothing found in this browser&apos;s local storage to import.</p>
          ) : null}
          {outcome.imported.length > 0 ? (
            <ResultList label="Imported" ids={outcome.imported} reportById={reportById} />
          ) : null}
          {outcome.skipped.length > 0 ? (
            <ResultList label="Skipped (already on the server)" ids={outcome.skipped} reportById={reportById} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ResultList({ label, ids, reportById }: { label: string; ids: string[]; reportById: Map<string, AnyReport> }) {
  return (
    <div className={styles.resultBlock}>
      <div className={styles.resultLabel}>{label}</div>
      <ul className={styles.resultListItems}>
        {ids.map((id) => {
          const report = reportById.get(id);
          return (
            <li key={id} className={styles.resultItem}>
              {id}
              {report ? ` — ${report.kind === 'weekly' ? 'Weekly' : 'Daily'} ${reportPeriodLabel(report)}` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
