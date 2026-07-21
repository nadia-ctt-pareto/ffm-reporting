'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { useDailyReports } from '@/lib/hooks/useDailyReports';
import { useProjects } from '@/lib/hooks/useProjects';
import { useReports } from '@/lib/hooks/useReports';
import type { ImportIssue, ImportResult } from '@/lib/import';
import { parseImportCsv } from '@/lib/import';
import { resolveNewProjectName } from '@/lib/projects';
import { reportPeriodLabel, statusTone } from '@/lib/report-utils';
import type { Project } from '@/lib/types';
import styles from './CsvImportSection.module.css';

const HOUSE_VALUE = '__house__';
const NEW_PROJECT_VALUE = '__new__';
/** Uploads above this size are rejected before `FileReader` even reads them -- a friendly guard against a pathological file bloating the live in-render `parseImportCsv` preview (see the doc comment on `result` below). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const EMPTY_RESULT: ImportResult = { reports: [], issues: [] };

/**
 * Phase 6b: the live CSV importer -- upload a file built to the
 * `IMPORT_COLUMNS` contract (lib/csv-templates.ts / the two template
 * downloads directly above this section), choose which project it belongs
 * to, preview the parsed result (an issue list, or a report-by-report
 * summary), then commit. All parsing is pure (`lib/import.ts`'s
 * `parseImportCsv`) -- nothing is persisted until "Import N Reports" is
 * clicked, and even then only if there are zero issues (all-or-nothing, see
 * that file's header comment). The live preview re-parses on every relevant
 * change (file, project choice, new-project name) using a NOT-YET-PERSISTED
 * synthetic project id for the "New project…" case, so an abandoned import
 * (user picks a project, uploads a bad file, never clicks Import) never
 * creates a stray project -- the real `upsertProject` call only happens
 * inside `handleImport`, immediately before the committing parse.
 *
 * Commit is a batch write, not a per-report loop: `committed.reports` is
 * split by kind and each kind-specific batch goes through ONE `upsertMany`
 * call (`useReports`/`useDailyReports`), awaited in sequence. Firing
 * `upsertReport` once per report (the pre-review-fix approach) is NOT
 * safe -- `upsert()` is an async read-modify-write, so N un-awaited calls
 * can all read the same pre-import snapshot and race to write it back,
 * silently persisting only the last one. See `ReportsRepository.upsertMany`
 * (lib/data/reports-repository.ts) for the full rationale.
 */
export function CsvImportSection() {
  const { projects, upsertProject } = useProjects();
  const { upsertMany: upsertManyWeekly } = useReports();
  const { reports: dailies, upsertMany: upsertManyDaily } = useDailyReports();

  const [projectChoice, setProjectChoice] = useState<string>(HOUSE_VALUE);
  const [newProjectName, setNewProjectName] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  /**
   * BLOCKER B (post-review round 2): set when a commit fails AFTER at least
   * one of the two kind-specific batches already landed (the documented
   * two-transaction caveat -- weeklies commit, then dailies fail, or vice
   * versa). Making the error VISIBLE (as the round-1 fix pass did) invites
   * exactly the retry that duplicates data: `handleImport` re-runs
   * `parseImportCsv`, which mints FRESH ids for every report (CLAUDE.md:
   * "All ids are freshly generated") -- including the ones that already
   * committed. Dailies are protected by `reports_one_daily_per_day`, but
   * weeklies have NO uniqueness constraint at all, so a retry would
   * silently duplicate them. Once set, `canImport` (below) is permanently
   * `false` for THIS parsed file -- the user must choose a different file
   * (which resets this via the `useEffect` below) rather than retry the
   * exact one that partially committed.
   */
  const [partialCommit, setPartialCommit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectOptions: SelectOption[] = useMemo(
    () => [
      { value: HOUSE_VALUE, label: 'No project (house reports)' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
      { value: NEW_PROJECT_VALUE, label: 'New project…' },
    ],
    [projects]
  );

  // Validated once here (not re-implemented at commit time) so the live
  // preview and the actual commit can never disagree about whether a new
  // project name is usable.
  const newProjectResolution = projectChoice === NEW_PROJECT_VALUE && projects ? resolveNewProjectName(newProjectName, projects) : null;

  /** Resolves the effective target project id + project list for a parse, WITHOUT persisting a "New project…" name (see the class doc comment above). Null while incomplete (blank name) or invalid (a name resolveNewProjectName rejected). */
  function resolveTarget(): { targetProjectId: string | null; effectiveProjects: Project[] } | null {
    if (!projects) return null;
    if (projectChoice === HOUSE_VALUE) return { targetProjectId: null, effectiveProjects: projects };
    if (projectChoice === NEW_PROJECT_VALUE) {
      if (!newProjectResolution || newProjectResolution.error) return null;
      return { targetProjectId: newProjectResolution.id, effectiveProjects: [...projects, { id: newProjectResolution.id, name: newProjectResolution.name }] };
    }
    return { targetProjectId: projectChoice, effectiveProjects: projects };
  }

  const target = resolveTarget();

  const result: ImportResult = useMemo(() => {
    if (!fileText || !dailies || !target) return EMPTY_RESULT;
    return parseImportCsv(fileText, target.targetProjectId, { dailies, projects: target.effectiveProjects });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `target` is recomputed fresh every render from `projects`/`projectChoice`/`newProjectName`; including it directly (rather than those three primitives) keeps this in sync without an extra layer of memoization.
  }, [fileText, dailies, projectChoice, newProjectName, projects]);

  // A file re-upload, or changing the project choice, invalidates any prior
  // "Imported N reports" banner or commit error -- including the BLOCKER B
  // partial-commit lock (a genuinely NEW file/target is a fresh attempt,
  // not a retry of the one that partially committed).
  useEffect(() => {
    setImportedCount(null);
    setCommitError(null);
    setPartialCommit(false);
  }, [fileText, projectChoice, newProjectName]);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file name to re-run a parse
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileName(null);
      setFileText(null);
      setFileError(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB -- please upload a file under 5 MB.`);
      return;
    }
    setFileError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setFileText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!fileText || !dailies || !target || isImporting) return;
    setIsImporting(true);
    setCommitError(null);
    // BLOCKER B (post-review round 2): declared OUTSIDE the try block (not
    // `let` inside it) specifically so the `catch` below can still read
    // whichever batch(es) actually committed before the failure -- see the
    // doc comment further down, at the point they're set.
    let committedWeeklies = 0;
    let committedDailies = 0;
    try {
      let finalTarget = target;
      if (projectChoice === NEW_PROJECT_VALUE) {
        if (!newProjectResolution || newProjectResolution.error) return;
        const project: Project = { id: newProjectResolution.id, name: newProjectResolution.name };
        finalTarget = { targetProjectId: project.id, effectiveProjects: [...(projects ?? []), project] };
        // Post-review fix (SHOULD-FIX 12): AWAITED, not fire-and-forget.
        // `upsertProject` now rejects on a failed write (Supabase down, an
        // RLS insert denial, a dropped network request) -- previously this
        // was fire-and-forget, so ordering was "safe" only by accident (the
        // repository's write queue serializes it ahead of the `upsertMany`
        // calls below regardless), but a REJECTION was never caught: it
        // became an unhandled promise rejection, and the report batch below
        // still ran, then failed with a confusing FK-violation error naming
        // a raw constraint instead of "the project couldn't be created."
        // Caught by the single `catch` below now, same as everything else
        // in this function.
        await upsertProject(project);
      }
      const committed = parseImportCsv(fileText, finalTarget.targetProjectId, { dailies, projects: finalTarget.effectiveProjects });
      if (committed.issues.length > 0) {
        // Shouldn't happen if the live preview already showed zero issues
        // (e.g. a same-tick daily added elsewhere between preview and
        // click) -- surfaced as a visible error, not a silent no-op.
        setCommitError('The file no longer imports cleanly (something changed since the preview was shown) -- please re-check it and try again.');
        return;
      }
      const weeklies = committed.reports.filter((r) => r.kind === 'weekly');
      const dailyReports = committed.reports.filter((r) => r.kind === 'daily');
      // Sequential, not concurrent: each `upsertMany` call is ONE
      // loadAll()+ONE write; awaiting between the two kind-specific batches
      // (rather than firing both at once) is what keeps the second batch's
      // loadAll() from reading a stale pre-first-batch snapshot, which
      // would silently drop the first batch entirely (see
      // ReportsRepository.upsertMany's doc comment).
      //
      // Phase 7b: `upsertMany` now rejects on a failed write (Supabase
      // down, RLS denial, an FK violation against a project that failed to
      // create, ...) instead of silently no-op'ing -- caught by the single
      // `catch` below (merged with the project-upsert catch, post-review
      // fix) so a commit failure surfaces as a visible message instead of
      // an unhandled rejection. `committedWeeklies`/`committedDailies` track
      // which batch(es) actually landed BEFORE a failure, for BLOCKER B
      // below (post-review round 2) -- a weeklies-succeeded/dailies-failed
      // partial commit (this repo's existing documented two-transaction
      // caveat, unchanged by Phase 7b) must not just be reported, but must
      // also block a same-file retry from duplicating what already landed.
      if (weeklies.length > 0) {
        await upsertManyWeekly(weeklies);
        committedWeeklies = weeklies.length;
      }
      if (dailyReports.length > 0) {
        await upsertManyDaily(dailyReports);
        committedDailies = dailyReports.length;
      }
      setImportedCount(committed.reports.length);
    } catch (err) {
      // BLOCKER B (post-review round 2): distinguish "nothing committed,
      // safe to retry" from "part of this file already committed, retrying
      // would duplicate it" -- see `partialCommit`'s doc comment above.
      // `committedWeeklies`/`committedDailies` are only non-zero here if
      // their respective `upsertMany` call above actually resolved before
      // the OTHER one (or the project upsert) threw.
      if (committedWeeklies > 0 || committedDailies > 0) {
        setPartialCommit(true);
        setCommitError(
          `${committedWeeklies} weekly and ${committedDailies} daily report${committedWeeklies + committedDailies === 1 ? '' : 's'} were saved before this failed. Re-importing this file would duplicate them (weekly reports have no way to detect a duplicate) -- choose a different file, or check with an admin before retrying this one.`
        );
      } else {
        setCommitError(err instanceof Error ? err.message : 'Failed to save the import -- please try again.');
      }
    } finally {
      setIsImporting(false);
    }
  }

  const hasFile = fileText !== null;
  const canImport =
    hasFile &&
    target !== null &&
    result.issues.length === 0 &&
    result.reports.length > 0 &&
    importedCount === null &&
    !isImporting &&
    // BLOCKER B (post-review round 2): permanently disabled once THIS
    // file's commit has partially landed -- see `partialCommit`'s doc
    // comment.
    !partialCommit;
  const weeklyCount = result.reports.filter((r) => r.kind === 'weekly').length;
  const dailyCount = result.reports.filter((r) => r.kind === 'daily').length;

  return (
    <section className={styles.section}>
      <div className={styles.sectionKicker}>CSV Import</div>
      <p className={styles.sectionCopy}>
        Upload a file built to the column contract above -- one row per report/task/risk/priority, discriminated by row_type.
        Every report in one upload lands in the SAME project (choose it below); to import reports from more than one
        project, run this twice.
      </p>

      <div className={styles.controlsRow}>
        <div style={{ width: 260 }}>
          <Select label="Project" options={projectOptions} value={projectChoice} onChange={setProjectChoice} />
        </div>
        {projectChoice === NEW_PROJECT_VALUE ? (
          <div style={{ width: 260 }}>
            <Input
              label="New Project Name"
              placeholder="e.g. Riverside Property Group"
              value={newProjectName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewProjectName(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {newProjectResolution?.error ? <p className={styles.fieldError}>{newProjectResolution.error}</p> : null}

      <div className={styles.fileRow}>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          Choose CSV File
        </Button>
        <input ref={fileInputRef} className={styles.fileInput} type="file" accept=".csv,text/csv" onChange={handleFile} />
        {fileName ? <span className={styles.fileName}>{fileName}</span> : null}
      </div>
      {fileError ? <p className={styles.fieldError}>{fileError}</p> : null}

      {importedCount !== null ? (
        <div className={styles.successBanner}>
          Imported {importedCount} report{importedCount === 1 ? '' : 's'}.
        </div>
      ) : null}
      {commitError ? <p className={styles.fieldError}>{commitError}</p> : null}

      {hasFile && result.issues.length > 0 && importedCount === null ? (
        <div className={styles.issuePanel}>
          <div className={styles.issueHeading}>
            {result.issues.length} issue{result.issues.length === 1 ? '' : 's'} found -- nothing was imported.
          </div>
          <ul className={styles.issueList}>
            {result.issues.map((issue, i) => (
              <li key={i} className={styles.issueItem}>
                {formatIssue(issue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasFile && result.issues.length === 0 && result.reports.length > 0 && importedCount === null ? (
        <div className={styles.previewPanel}>
          <div className={styles.previewHeading}>
            {weeklyCount} weekly / {dailyCount} daily report{result.reports.length === 1 ? '' : 's'} found
          </div>
          <ul className={styles.previewList}>
            {result.reports.map((report) => (
              <li key={report.id} className={styles.previewItem}>
                <span className={styles.previewLabel}>
                  {report.kind === 'weekly' ? 'Weekly' : 'Daily'} — {reportPeriodLabel(report)}
                </span>
                <Badge tone={statusTone(report.status)}>{report.status}</Badge>
                <span className={styles.previewCounts}>
                  {report.tasks.length} task{report.tasks.length === 1 ? '' : 's'}, {report.risks.length} risk
                  {report.risks.length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.templateRow}>
        <Button variant="primary" size="sm" disabled={!canImport} onClick={handleImport}>
          {isImporting ? 'Importing…' : `Import ${result.reports.length} Report${result.reports.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </section>
  );
}

function formatIssue(issue: ImportIssue): string {
  const column = issue.column ? ` (${issue.column})` : '';
  return `Row ${issue.row}${column}: ${issue.message}`;
}
