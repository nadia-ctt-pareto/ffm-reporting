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
import { isBlankProjectName, slugifyProjectName } from '@/lib/projects';
import { reportPeriodLabel, statusTone } from '@/lib/report-utils';
import type { Project } from '@/lib/types';
import styles from './CsvImportSection.module.css';

const HOUSE_VALUE = '__house__';
const NEW_PROJECT_VALUE = '__new__';
/** Uploads above this size are rejected before `FileReader` even reads them -- a friendly guard against a pathological file bloating the live in-render `parseImportCsv` preview (see the doc comment on `result` below). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const EMPTY_RESULT: ImportResult = { reports: [], issues: [] };

interface NewProjectResolution {
  id: string;
  name: string;
  error?: string;
}

/**
 * Validates a "New project…" name BEFORE it's ever slugified into a
 * persisted `Project.id` -- two failure modes this specifically closes
 * (found by the Phase 6b security review):
 *
 * 1. A name that slugifies to the SAME id as an ALREADY-EXISTING project
 *    (a casing/punctuation variant -- e.g. "DryRoot Waterproofing" and
 *    "dryroot waterproofing" both slugify to "dryroot-waterproofing")
 *    would silently overwrite that project's canonical `name` the moment
 *    it's `upsertProject`'d (insert-or-REPLACE-by-id) -- permanently
 *    renaming a seeded/existing project out from under every report that
 *    references it by name.
 * 2. A name with no letters/digits at all (e.g. `"..."`, an emoji-only
 *    string) slugifies to `''`, which collides with the house bucket's own
 *    key (`sameProjectBucket`'s `?? ''` coalesce) and crashes Radix's
 *    `Select` (rejects an empty-string item value) the next time
 *    `/settings`'s Project dropdown renders it -- a persistent, self-
 *    inflicted white-screen, since the bad project is already saved.
 *
 * Returns `null` only when `rawName` is blank (nothing typed yet -- not an
 * error state, just incomplete); otherwise always returns a resolution,
 * with `.error` set when the name can't be used as typed.
 */
function resolveNewProject(rawName: string, projects: Project[]): NewProjectResolution | null {
  const name = rawName.trim();
  if (!name) return null;
  // Checked BEFORE calling slugifyProjectName -- that function never returns
  // `''` (it has its own uid() fallback, defense in depth), so checking its
  // output could never observe this case; isBlankProjectName checks the raw
  // slugification directly.
  if (isBlankProjectName(name)) {
    return { id: '', name, error: 'Project name must contain at least one letter or number.' };
  }
  const id = slugifyProjectName(name);
  const existingById = projects.find((p) => p.id === id);
  if (existingById) {
    return existingById.name === name
      ? { id, name, error: `"${name}" already exists -- pick it from the Project dropdown instead of creating it again.` }
      : {
          id,
          name,
          error: `"${name}" would collide with the existing project "${existingById.name}" -- pick it from the dropdown, or use a more distinct name.`,
        };
  }
  return { id, name };
}

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
  const newProjectResolution = projectChoice === NEW_PROJECT_VALUE && projects ? resolveNewProject(newProjectName, projects) : null;

  /** Resolves the effective target project id + project list for a parse, WITHOUT persisting a "New project…" name (see the class doc comment above). Null while incomplete (blank name) or invalid (a name resolveNewProject rejected). */
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

  // A file re-upload, or changing the project choice, invalidates any prior "Imported N reports" banner or commit error.
  useEffect(() => {
    setImportedCount(null);
    setCommitError(null);
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
    try {
      let finalTarget = target;
      if (projectChoice === NEW_PROJECT_VALUE) {
        if (!newProjectResolution || newProjectResolution.error) return;
        const project: Project = { id: newProjectResolution.id, name: newProjectResolution.name };
        upsertProject(project);
        finalTarget = { targetProjectId: project.id, effectiveProjects: [...(projects ?? []), project] };
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
      if (weeklies.length > 0) await upsertManyWeekly(weeklies);
      if (dailyReports.length > 0) await upsertManyDaily(dailyReports);
      setImportedCount(committed.reports.length);
    } finally {
      setIsImporting(false);
    }
  }

  const hasFile = fileText !== null;
  const canImport =
    hasFile && target !== null && result.issues.length === 0 && result.reports.length > 0 && importedCount === null && !isImporting;
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
