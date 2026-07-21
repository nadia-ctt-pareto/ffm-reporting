'use client';

import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/app/PageHeader';
import { useTheme } from '@/components/theme/ThemeProvider';
import type { ThemePreference } from '@/components/theme/ThemeProvider';
import { Button } from '@/components/ui/Button';
import { downloadCsv } from '@/lib/csv';
import { buildDailyImportTemplateCsv, buildWeeklyImportTemplateCsv } from '@/lib/csv-templates';
import { PROMPT_TEMPLATES } from '@/lib/prompts';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { CsvImportSection } from './CsvImportSection';
import { LocalDataImportSection } from './LocalDataImportSection';
import styles from './SettingsScreen.module.css';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * `/settings` -- four sections, plus a fifth in Supabase mode: (a) an
 * Appearance theme picker (Light/Dark/System, built from existing `Button`s
 * with `aria-pressed` -- no new Radix wrapper needed, `Tabs` implies content
 * panels and `Select` is overkill for 3 mutually-exclusive options), (b) a
 * static prompt library for the future Claude connector (copy-to-clipboard,
 * reusing `ReportScreen`'s clipboard + 1800ms copied-state pattern), (c) two
 * CSV import template downloads (the import contract, see
 * lib/csv-templates.ts), (d) the live CSV importer (Phase 6b) directly below
 * the templates, and (e, Phase 7b M4) `LocalDataImportSection` -- rendered
 * only when `isSupabaseConfigured()`, since it's a one-time
 * localStorage-to-Postgres migration tool with nothing to do in demo mode
 * (there is no "elsewhere" for demo mode's own localStorage data to move
 * to). `CsvImportSection`/`LocalDataImportSection` are their own components
 * (not inlined here) so this screen stays thin; each owns all of its own
 * upload/preview/project-choice or import-progress state.
 */
export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    []
  );

  const handleCopy = (id: string, body: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body).catch(() => {});
    }
    setCopiedId(id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div>
      <PageHeader title="Settings" />

      <div className={styles.content}>
        <section className={styles.section}>
          <div className={styles.sectionKicker}>Appearance</div>
          <div className={styles.themeRow} role="group" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={preference === opt.value ? 'dark' : 'outline'}
                size="sm"
                aria-pressed={preference === opt.value}
                onClick={() => setPreference(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionKicker}>Prompt Library</div>
          <p className={styles.sectionCopy}>For use with the Claude connector (arriving in a later phase).</p>
          <div className={styles.promptList}>
            {PROMPT_TEMPLATES.map((prompt) => (
              <div key={prompt.id} className={styles.promptCard}>
                <div className={styles.promptHeading}>
                  <span className={styles.promptTitle}>{prompt.title}</span>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(prompt.id, prompt.body)}>
                    {copiedId === prompt.id ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className={styles.promptDescription}>{prompt.description}</p>
                <pre className={styles.promptBody}>{prompt.body}</pre>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionKicker}>CSV Import Templates</div>
          <p className={styles.sectionCopy}>
            The column contract the importer below parses -- one row per report/task/risk/priority, discriminated by
            row_type.
          </p>
          <div className={styles.templateRow}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv('weekly-import-template.csv', buildWeeklyImportTemplateCsv())}
            >
              Download Weekly Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv('daily-import-template.csv', buildDailyImportTemplateCsv())}
            >
              Download Daily Template
            </Button>
          </div>
        </section>

        <CsvImportSection />

        {isSupabaseConfigured() ? <LocalDataImportSection /> : null}
      </div>
    </div>
  );
}
