// Phase 5 (Settings): a static library of prompt templates for driving this
// app's data through the Claude connector -- not wired to anything yet (the
// connector itself is Phase 8's `app/api/mcp`). Rendered as a copy-to-
// clipboard card list on `/settings`.
//
// Tool names referenced below are the contract for app/api/mcp (Phase 8)
// and skills/ -- change all three together.
//
// Canonical MCP tool names:
//   Read:  list_reports, get_report, list_projects, get_week_rollup
//   Write: create_report, update_report, create_project, create_weekly_from_dailies
//   (there is deliberately no delete_report)

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  body: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'draft-weekly-from-dailies',
    title: 'Draft this week’s report from daily reports',
    description: 'Rolls up the week’s daily reports into a weekly draft, then asks you to review before creating it.',
    body: 'Call get_week_rollup for the week starting {week_start}. Summarize the tasks, risks, and priorities you find, then show me the summary before calling create_weekly_from_dailies to create the weekly report.',
  },
  {
    id: 'weekly-status-digest',
    title: 'Weekly status digest',
    description: 'A short, client-ready summary of the latest report for a given prepared-for contact.',
    body: 'Call list_reports filtered to prepared_for = "{prepared_for}" and pick the most recent one. Call get_report on it, then write a 3-4 sentence status digest covering tasks on schedule, open blockers, and the week’s win -- suitable for pasting into an email.',
  },
  {
    id: 'blocker-triage',
    title: 'Blocker triage across N weeks',
    description: 'Surfaces every open blocker over a trailing window and flags the ones that keep recurring.',
    body: 'Call list_reports for the last {n} weeks. For each, call get_report and collect every task or risk marked Blocked. Group the results by client, and call out any blocker that appears in more than one week in a row.',
  },
  {
    id: 'consolidate-week-across-projects',
    title: 'Consolidate a week across projects',
    description: 'Merges multiple projects’ reports for the same week into one cross-project narrative.',
    body: 'Call list_projects, then call list_reports for each project for the week of {week_start}. Call get_report on each result and produce one consolidated narrative: overall progress, the top 3 risks across all projects, and a single combined win.',
  },
  {
    id: 'csv-import-assistant',
    title: 'CSV import assistant',
    description: 'Walks through preparing a CSV against this app’s import contract before it’s uploaded.',
    body: 'I have a CSV of reports I want to import using the column contract from this app’s CSV import templates (kind, report_key, row_type, week_start, week_end, date, status, prepared_for, prepared_by, summary, client, item, item_status, deadline, severity, next_step, win_stat, win_label, win_narrative, calls, emails, escalations, touchpoints_note). Help me map my source data onto these columns, one row per report/task/risk/priority, before I upload it.',
  },
];
