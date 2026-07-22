'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { ProjectsManager } from '@/components/projects/ProjectsManager';
import { TeamManager } from '@/components/team/TeamManager';
import { useTheme } from '@/components/theme/ThemeProvider';
import type { ThemePreference } from '@/components/theme/ThemeProvider';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import type { TabItem } from '@/components/ui/Tabs';
import { downloadCsv } from '@/lib/csv';
import { buildDailyImportTemplateCsv, buildWeeklyImportTemplateCsv } from '@/lib/csv-templates';
import { PROMPT_TEMPLATES } from '@/lib/prompts';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { AiKeySection } from './AiKeySection';
import { CsvImportSection } from './CsvImportSection';
import { LocalDataImportSection } from './LocalDataImportSection';
import { McpAccessSection } from './McpAccessSection';
import styles from './SettingsScreen.module.css';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const TABS = ['appearance', 'projects', 'team', 'import', 'claude'] as const;
type SettingsTab = (typeof TABS)[number];

function isTab(value: string | null): value is SettingsTab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

/**
 * `/settings` -- the sections regrouped (nav IA restructure) into five
 * tab-navigable panels, deep-linkable via `?tab=<value>`:
 *  - **Appearance**: the theme picker (Light/Dark/System).
 *  - **Projects**: the self-contained `ProjectsManager` (also the `/projects`
 *    route). This is where Projects lives now that it left the sidebar.
 *  - **Team** (WP1): the self-contained `TeamManager` -- the Foundation First
 *    team directory (list/create/rename/delete, admin-gated). See
 *    `components/team/TeamManager.tsx`'s own doc comment.
 *  - **Import**: CSV import templates + the live CSV importer + (Supabase)
 *    Local Data Import.
 *  - **Claude & AI**: the MCP prompt library + (Supabase) MCP Access + AI Polish.
 *
 * Tab grouping is chosen so no tab is empty in demo mode (Appearance, Projects,
 * Team, a template/importer, and the always-on prompt library each carry their
 * tab). `Tabs` unmounts inactive panels, so each section's mount-time fetch
 * (Team members, MCP tokens, AI-key status) is deferred until its tab is first
 * opened -- fine. `?tab=` is synced with `window.history.replaceState`
 * (shallow, same idiom as PresentScreen's `?slide=`); reading
 * `useSearchParams()` is why the route wraps this in `<Suspense>`.
 */
export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const searchParams = useSearchParams();
  const paramTab = searchParams.get('tab');

  const [tab, setTab] = useState<SettingsTab>(isTab(paramTab) ? paramTab : 'appearance');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    []
  );

  const handleTabChange = (value: string) => {
    const next = isTab(value) ? value : 'appearance';
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  const handleCopy = (id: string, body: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body).catch(() => {});
    }
    setCopiedId(id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1800);
  };

  const supabase = isSupabaseConfigured();

  const items: TabItem[] = [
    {
      value: 'appearance',
      label: 'Appearance',
      content: (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionKicker}>Theme</div>
            <p className={styles.sectionCopy}>Choose a light or dark appearance, or follow your system setting.</p>
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
        </div>
      ),
    },
    {
      value: 'projects',
      label: 'Projects',
      content: (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <p className={styles.sectionCopy}>
              Projects group related reports and power consolidation buckets. Renaming and deleting a project live on its own
              page.
            </p>
            <ProjectsManager />
          </section>
        </div>
      ),
    },
    {
      value: 'team',
      label: 'Team',
      content: (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <p className={styles.sectionCopy}>The Foundation First team directory -- used by assignee pickers on tasks (a later package).</p>
            <TeamManager />
          </section>
        </div>
      ),
    },
    {
      value: 'import',
      label: 'Import',
      content: (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionKicker}>CSV Import Templates</div>
            <p className={styles.sectionCopy}>
              The column contract the importer below parses -- one row per report/task/risk/priority, discriminated by
              row_type.
            </p>
            <div className={styles.templateRow}>
              <Button variant="outline" size="sm" onClick={() => downloadCsv('weekly-import-template.csv', buildWeeklyImportTemplateCsv())}>
                Download Weekly Template
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadCsv('daily-import-template.csv', buildDailyImportTemplateCsv())}>
                Download Daily Template
              </Button>
            </div>
          </section>

          <CsvImportSection />

          {supabase ? <LocalDataImportSection /> : null}
        </div>
      ),
    },
    {
      value: 'claude',
      label: 'Claude & AI',
      content: (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionKicker}>Prompt Library</div>
            <p className={styles.sectionCopy}>
              For use with the Claude connector -- create a token below (Supabase mode) and paste one of these into Claude.
            </p>
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

          {supabase ? <McpAccessSection /> : null}
          {supabase ? <AiKeySection /> : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Settings" />

      <div className={styles.content}>
        <Tabs value={tab} onChange={handleTabChange} items={items} aria-label="Settings sections" />
      </div>
    </div>
  );
}
