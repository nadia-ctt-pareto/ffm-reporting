// Phase 5 (Settings): a static library of prompt templates for driving this
// app's data through the Claude connector. Rendered as a copy-to-clipboard
// card list on `/settings`, directly above Phase 8a's `McpAccessSection`
// (create a token, then paste one of these into Claude).
//
// Tool names referenced below are the contract for app/api/[transport]
// (Phase 8a's `/api/mcp`, `lib/server/mcp-tools.ts`'s `MCP_TOOL_NAMES`) and
// `skills/weekly-reports/SKILL.md` -- change all three together.
// `scripts/check-mcp-tool-contract.ts` machine-checks this comment block
// against `MCP_TOOL_NAMES` (parsing the "Read:"/"Write:" lines below
// directly, since this file stays comment-only by design -- no exported
// const list lives here) -- keep the "Read:"/"Write:" line shape intact if
// you ever edit this block, or that script's parser needs a matching update.
//
// Canonical MCP tool names:
//   Read:  list_reports, get_report, list_projects, get_week_rollup
//   Write: create_report, update_report, create_project, create_weekly_from_dailies
//   (there is deliberately no delete_report -- see SKILL.md's "Access model")
//
// Phase 7c: `HOUSE_VOICE` below is the shared house-writing-style constant
// this comment used to describe as "planned for a future phase" -- it now
// exists, and both the BYOK polish system prompt (lib/server/ai-polish.ts)
// and `skills/weekly-reports/SKILL.md`'s "Voice" section reference it by
// name, so the web app and Claude-via-MCP can never drift into two
// different voices. `POLISH_FIELD_IDS`/`PolishFieldId`/`POLISH_FIELDS`
// (below) are the per-field editorial-intent registry that powers each
// polishable field's "Polish" button (components/ai/PolishButton.tsx) --
// deliberately NOT one generic "improve this" prompt; see `POLISH_FIELDS`'s
// own doc comment for what's excluded and why.

/**
 * Phase 7c. Foundation First's house writing style for client-facing report
 * prose -- shared verbatim between the BYOK polish system prompt
 * (`lib/server/ai-polish.ts`'s `buildSystemPrompt`) and the MCP Skill
 * (`skills/weekly-reports/SKILL.md`'s "Voice" section), so the app and
 * Claude-via-MCP can never describe two different voices. Deliberately one
 * flat paragraph, not a bulleted style guide -- it's meant to be dropped
 * straight into a system prompt.
 */
export const HOUSE_VOICE =
  'You are writing as a project manager at Foundation First Marketing, a boutique marketing agency, drafting a ' +
  'client-facing status report. The voice is concise, concrete, and client-appropriate: plain business English, ' +
  'active voice, specific outcomes and numbers over vague adjectives. No corporate filler ("I\'m pleased to ' +
  'report", "as previously mentioned", "moving forward"), no hype, no exclamation marks, no internal jargon a ' +
  'client would not recognize. Say exactly what happened and what it means -- nothing more, nothing less.';

/**
 * Phase 7c. The complete set of report fields the BYOK polish feature will
 * ever touch -- `PolishButton` only ever renders for one of these ids. See
 * `POLISH_FIELDS` below for what's deliberately EXCLUDED, and why.
 */
export const POLISH_FIELD_IDS = [
  'summary',
  'winNarrative',
  'touchpointsNarrative',
  'riskDescription',
  'riskNextStep',
  'priority',
  'taskTitle',
] as const;

export type PolishFieldId = (typeof POLISH_FIELD_IDS)[number];

export interface PolishFieldSpec {
  /** Human label for the field -- used only for the polish button's aria-label/title, never sent to Anthropic on its own (it's folded into `instructions` below). */
  label: string;
  /** The field-specific editorial-intent block appended to `HOUSE_VOICE` in the system prompt (`lib/server/ai-polish.ts`'s `buildSystemPrompt`) -- this is what makes "Polish" mean something different for a risk description than for a win narrative, the explicit ask behind this feature. */
  instructions: string;
}

/**
 * Phase 7c. Per-field editorial intent -- deliberately NOT one generic
 * "improve this" prompt. Grounded in `lib/schema/report.ts` and the wizard
 * steps that edit each field (StepBasics/StepTouchpointsWin/StepRisks/
 * StepPriorities/StepTasks).
 *
 * EXCLUDED, on purpose -- never add these here:
 * - `client` (`Task.client` / `Risk.client`) -- HARD exclusion,
 *   data-integrity: it's the exact-equality dedupe key `(client, task)` /
 *   `(client, description)` used throughout `useWizard`'s carry-forward
 *   Import panels, `lib/aggregate.ts`, and consolidation, and it's the
 *   input to `projectIdForClientName` (`lib/projects.ts`). Rewriting it
 *   would silently break dedupe and project stamping.
 * - `preparedFor` / `preparedBy` -- people's names and titles; "polishing"
 *   a name is simply wrong.
 * - `win.stat` / `win.label` -- the stat is a number, not prose; the label
 *   is a tight display string feeding the deck's hero-stat layout, where
 *   the author's exact phrasing is the point and any expansion breaks the
 *   layout.
 * - Dates, touchpoint counts, `status`/`severity` enums -- not prose.
 */
export const POLISH_FIELDS: Record<PolishFieldId, PolishFieldSpec> = {
  summary: {
    label: 'Executive Summary',
    instructions:
      'This is an executive summary the client (often a founder) will read first. Lead with overall status, then ' +
      'concrete outcomes -- what moved, what shipped, what changed. Concise and confident; 2-5 sentences. Preserve ' +
      'every fact, number, name, and date in the input exactly.',
  },
  winNarrative: {
    label: 'Win Narrative',
    instructions:
      "This is the story behind this week's win stat -- connect the number to a concrete client outcome. " +
      "Grounded, not hype: no exclamation marks, no superlatives the input itself didn't earn. One short " +
      'paragraph.',
  },
  touchpointsNarrative: {
    label: 'Touchpoints Notes',
    instructions:
      'These are factual notes on client communication cadence this period. Neutral and matter-of-fact -- ' +
      'compress rather than expand. 1-3 sentences.',
  },
  riskDescription: {
    label: 'Risk Description',
    instructions:
      "State what is at risk or blocked, why, and the impact -- specific, non-alarmist, non-minimizing, and " +
      "without assigning blame. Don't restate the client name (it has its own column, and this text should read " +
      'on its own). One sentence.',
  },
  riskNextStep: {
    label: 'Next Step',
    instructions:
      'Action-oriented and verb-first -- what happens next to resolve this. Keep any owner or date the input ' +
      'already gives; never invent one that is not there. One sentence, starting with a verb.',
  },
  priority: {
    label: 'Priority',
    instructions:
      'One crisp, verb-first priority for the coming period, naming a concrete deliverable. Never merge two ' +
      'priorities into one, and never split one into several -- return exactly one line.',
  },
  taskTitle: {
    label: 'Task',
    instructions:
      'Normalize to a concise noun-phrase task title: consistent casing, no trailing punctuation, not a full ' +
      'sentence. Roughly 10 words or fewer. (This field is often messy after a daily-import or CSV import -- ' +
      'that is exactly what this polish is for.)',
  },
};

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
