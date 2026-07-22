// Verbatim TS port of design-source/original-dashboard.dc.html script block,
// ffSeedReports() (lines 449-506). Exact strings, dates, statuses, tasks,
// risks, wins, touchpoints, and priorities are preserved as-authored,
// including curly apostrophes (') and en/em dashes (– / —) where
// the prototype used them.
//
// Phase 4 adds seedDailyReports(): 5 daily reports (Mon-Fri, 2026-07-13..17)
// covering the same week as the last weekly seed (r7), so the wizard's
// "import this week's daily reports" action is demoable out of the box.
// These are new content (no prototype line reference) but deliberately
// contain overlapping (client, task) / (client, description) pairs across
// days -- with the status/nextStep progressing day to day -- so the
// aggregator's "keep the latest daily's version" dedup logic has something
// real to demonstrate.
//
// Task completion date adds an optional 5th argument to T() (completedAt,
// see that helper's own doc comment) -- stamped on exactly two already-
// Complete WEEKLY tasks (r1, r6; the Schedule view, `/tasks?view=schedule`,
// is weekly-only, see lib/task-schedule.ts, so stamping a daily-report task
// here would demonstrate nothing) so the Schedule view's day-level
// on-time/late classification has real recorded-date data to show
// side-by-side with its week-level inference fallback, right out of the
// box. Every other seeded task is left un-stamped on purpose, exactly as
// it always was.

import { FF_CLIENTS } from './constants';
import { uid } from './format';
import type { DailyReport, Priority, Project, Report, Risk, Task, WeeklyReport } from './types';

function mk(
  id: string,
  ws: string,
  we: string,
  status: Report['status'],
  tasks: Task[],
  risks: Risk[],
  win: Report['win'],
  touchpoints: Report['touchpoints'],
  priorities: Priority[],
  summaryNarrative: string
): WeeklyReport {
  return {
    id,
    kind: 'weekly',
    weekStart: ws,
    weekEnd: we,
    status,
    preparedFor: 'Christene, Founder',
    preparedBy: 'Jordan Reyes, Project Manager',
    createdAt: we,
    updatedAt: we,
    summaryNarrative,
    tasks,
    risks,
    win,
    touchpoints,
    priorities,
  };
}

function mkDaily(
  id: string,
  date: string,
  status: Report['status'],
  tasks: Task[],
  risks: Risk[],
  win: Report['win'],
  touchpoints: Report['touchpoints'],
  priorities: Priority[],
  summaryNarrative: string
): DailyReport {
  return {
    id,
    kind: 'daily',
    date,
    status,
    preparedFor: 'Christene, Founder',
    preparedBy: 'Jordan Reyes, Project Manager',
    createdAt: date,
    updatedAt: date,
    summaryNarrative,
    tasks,
    risks,
    win,
    touchpoints,
    priorities,
  };
}

/**
 * Task completion date: `completedAt` is an OPTIONAL 5th argument
 * (omitted entirely -- not defaulted to `''` -- when a caller doesn't pass
 * one), so every pre-existing `T(...)` call below keeps producing a task
 * with no `completedAt` key at all, exactly like a task saved before this
 * field existed. `seedReports()` stamps it on exactly two already-Complete
 * tasks (see below) to demonstrate the Schedule view's day-level on-time
 * vs. late buckets out of the box; every other Complete task in this seed
 * intentionally stays un-stamped, so the Schedule view's week-level
 * inference fallback ALSO has real data to demonstrate, side by side with
 * the recorded-date path.
 */
function T(client: string, task: string, status: Task['status'], deadline: string, completedAt?: string): Task {
  return completedAt !== undefined ? { id: uid('t'), client, task, status, deadline, completedAt } : { id: uid('t'), client, task, status, deadline };
}

function R(client: string, severity: Risk['severity'], description: string, nextStep: string): Risk {
  return { id: uid('rk'), client, severity, description, nextStep };
}

function P(text: string): Priority {
  return { id: uid('p'), text };
}

/** Line 449-506 */
export function seedReports(): WeeklyReport[] {
  return [
    mk(
      'r1',
      '2026-06-01',
      '2026-06-05',
      'Sent',
      [
        // Task completion date demo: a RECORDED completedAt one day before
        // the deadline -- the Schedule view classifies this to the day
        // ("completed-on-time", evidence tagged "(recorded)"), not via the
        // week-level fallback every other Complete task in this seed still
        // uses.
        T(FF_CLIENTS[0], 'Paid social campaign launch', 'Complete', '2026-06-05', '2026-06-04'),
        T(FF_CLIENTS[1], 'Search campaign audit', 'Complete', '2026-06-05'),
        T(FF_CLIENTS[2], 'Onboarding kickoff call', 'In Progress', '2026-06-12'),
        T(FF_CLIENTS[3], 'Website conversion audit', 'Complete', '2026-06-05'),
      ],
      [],
      {
        stat: '22%',
        label: "Lift in DryRoot's ad click-through rate",
        narrative:
          'New ad copy testing drove a 22% CTR improvement in DryRoot Waterproofing’s search campaigns in the first week live.',
      },
      {
        calls: 3,
        emails: 6,
        escalations: 0,
        narrative: "All four accounts had a kickoff or check-in call this week; Summit's onboarding is now fully underway.",
      },
      [
        P('Finalize Summit automation scope'),
        P('Launch DryRoot refreshed search campaign'),
        P('Deliver TerraFirm audit findings to client'),
      ],
      'Strong opening week across all four accounts. Summit’s onboarding is underway, and TerraFirm’s audit is already surfacing quick wins.'
    ),
    mk(
      'r2',
      '2026-06-08',
      '2026-06-12',
      'Sent',
      [
        T(FF_CLIENTS[1], 'Search campaign live', 'Complete', '2026-06-12'),
        T(FF_CLIENTS[2], 'CRM discovery & data mapping', 'In Progress', '2026-06-19'),
        T(FF_CLIENTS[3], 'Audit findings delivered', 'Complete', '2026-06-12'),
        T(FF_CLIENTS[0], 'Q3 planning draft', 'In Progress', '2026-06-19'),
      ],
      [
        R(
          FF_CLIENTS[2],
          'At Risk',
          "CRM export from Summit's previous platform is incomplete, delaying data mapping.",
          'Requested a full re-export; following up with their previous vendor directly.'
        ),
      ],
      {
        stat: '3',
        label: 'Quick-win fixes shipped from the TerraFirm audit',
        narrative:
          "TerraFirm's conversion audit uncovered three fast fixes to their contact form — all three shipped this week, ahead of the full redesign.",
      },
      {
        calls: 4,
        emails: 7,
        escalations: 0,
        narrative:
          "Regular check-ins with all accounts; Summit's data gap was flagged early rather than surfacing later in the automation build.",
      },
      [
        P('Complete Summit CRM migration prep'),
        P('Begin TerraFirm landing page redesign'),
        P("Finish Helitech's Q3 planning document"),
      ],
      "Momentum continues. TerraFirm's audit is already paying off, and we caught a data gap at Summit early enough to manage around it."
    ),
    mk(
      'r3',
      '2026-06-15',
      '2026-06-19',
      'Sent',
      [
        T(FF_CLIENTS[3], 'Landing page wireframes', 'In Progress', '2026-06-26'),
        T(FF_CLIENTS[2], 'Automation build kickoff', 'In Progress', '2026-06-26'),
        T(FF_CLIENTS[0], 'Q3 plan approved', 'Complete', '2026-06-19'),
        T(FF_CLIENTS[1], 'Ad copy A/B testing', 'In Progress', '2026-06-26'),
      ],
      [
        R(
          FF_CLIENTS[2],
          'At Risk',
          'CRM data gap from the previous platform is still being resolved.',
          'Automation build continues on available data while the export is finalized.'
        ),
      ],
      {
        stat: 'Approved',
        label: "Helitech's Q3 plan, with an expanded ad budget",
        narrative:
          "Helitech signed off on the Q3 plan this week, including a 15% budget increase for paid social — the strongest vote of confidence yet.",
      },
      {
        calls: 4,
        emails: 8,
        escalations: 0,
        narrative: "No escalations this week. Helitech's planning call ran long in the best way — lots of good questions.",
      },
      [
        P('Ship TerraFirm wireframes for client review'),
        P("Continue Summit's automation build"),
        P('Launch DryRoot ad copy test'),
      ],
      'A quieter week operationally but a big strategic win: Helitech approved an expanded Q3 plan.'
    ),
    mk(
      'r4',
      '2026-06-22',
      '2026-06-26',
      'Final',
      [
        T(FF_CLIENTS[3], 'Landing page wireframes approved', 'Complete', '2026-06-26'),
        T(FF_CLIENTS[2], 'Automation testing', 'In Progress', '2026-07-03'),
        T(FF_CLIENTS[1], 'Ad copy test results reviewed', 'Complete', '2026-06-26'),
        T(FF_CLIENTS[0], 'Ad refresh planning', 'In Progress', '2026-07-03'),
      ],
      [],
      {
        stat: '15%',
        label: "Reduction in DryRoot's cost-per-click",
        narrative:
          "The winning ad variant from this month's copy testing cut DryRoot's cost-per-click by 15% — now rolling out account-wide.",
      },
      {
        calls: 3,
        emails: 6,
        escalations: 0,
        narrative: "TerraFirm's wireframes were approved without revision — a fast, clean sign-off.",
      },
      [
        P('Build TerraFirm landing page from approved wireframes'),
        P("Finish Summit's automation testing"),
        P("Launch Helitech's ad refresh"),
      ],
      "Clean week — no open risks, one clear win on DryRoot's cost-per-click, and TerraFirm's design phase wrapped."
    ),
    mk(
      'r5',
      '2026-06-29',
      '2026-07-03',
      'Draft',
      [
        T(FF_CLIENTS[3], 'Landing page build', 'In Progress', '2026-07-10'),
        T(FF_CLIENTS[2], 'Automation QA', 'In Progress', '2026-07-10'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page build is paused. Waiting on updated project photos and testimonials, requested June 30.',
          'Follow-up sent; no response yet.'
        ),
      ],
      { stat: '', label: '', narrative: '' },
      { calls: 2, emails: 4, escalations: 0, narrative: 'Short week ahead of the holiday.' },
      [P('Follow up with TerraFirm on outstanding assets')],
      'Short week ahead of the holiday — this report is still in draft and needs the full round-up before sending.'
    ),
    mk(
      'r6',
      '2026-07-06',
      '2026-07-10',
      'Final',
      [
        T(FF_CLIENTS[0], 'Ad refresh live', 'Complete', '2026-07-10'),
        // Task completion date demo: a RECORDED completedAt ONE DAY AFTER
        // the deadline -- classified "completed-late" from the recorded
        // date, even though this report's period end (2026-07-10) equals
        // the deadline, which the pre-existing WEEK-level inference alone
        // would have called on-time. Demonstrates the day-level check
        // genuinely catching something week-level inference would miss
        // (a PM correcting the record after the report was already filed).
        T(FF_CLIENTS[1], 'Copy testing wrapped', 'Complete', '2026-07-10', '2026-07-11'),
        T(FF_CLIENTS[2], 'Automation QA continuing', 'In Progress', '2026-07-17'),
        T(FF_CLIENTS[3], 'Landing page build', 'Blocked', '2026-07-10'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page work is paused. Still waiting on updated project photos and testimonials, requested June 30.',
          'Escalating directly with the client this week.'
        ),
        R(
          FF_CLIENTS[2],
          'At Risk',
          'CRM data gaps are delaying the full GoHighLevel migration.',
          'Automation build continues on test data.'
        ),
      ],
      {
        stat: '9%',
        label: "Early dip in Helitech's cost-per-lead",
        narrative: "Helitech's refreshed ad creative went live Monday and cost-per-lead is already down 9% in the first week.",
      },
      {
        calls: 4,
        emails: 8,
        escalations: 1,
        narrative: "One escalation this week: TerraFirm's asset delay was raised directly on our call.",
      },
      [
        P("Launch DryRoot's refreshed search campaign"),
        P("Complete Summit's automation QA"),
        P('Finalize TerraFirm pending assets'),
        P('Prep Helitech Q3 review'),
      ],
      "Helitech's ad refresh is already showing results. TerraFirm remains blocked on client assets — escalating this week."
    ),
    mk(
      'r7',
      '2026-07-13',
      '2026-07-17',
      'Sent',
      [
        T(FF_CLIENTS[0], 'Paid social creative refresh', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[1], 'Search campaign copy testing', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[2], 'GoHighLevel pipeline automation', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[3], 'Landing page conversion audit', 'Blocked', '2026-07-17'),
        T(FF_CLIENTS[0], 'Monthly performance dashboard', 'Complete', '2026-07-17'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          "Landing page work is paused. We're waiting on updated project photos and testimonials, requested since June 30.",
          'Follow-up sent Thursday; will escalate if no response by Monday.'
        ),
        R(
          FF_CLIENTS[2],
          'At Risk',
          "The CRM export from Summit's previous platform is incomplete, delaying the full GoHighLevel data migration.",
          'Automation build continues on test data; full migration expected early next week.'
        ),
      ],
      {
        stat: '18%',
        label: "Drop in Helitech's cost-per-lead",
        narrative:
          "Following Monday's paid social creative refresh, Helitech Foundation & Waterproofing's cost-per-lead fell 18% week over week — the strongest result of any account this quarter.",
      },
      {
        calls: 4,
        emails: 9,
        escalations: 1,
        narrative:
          "Every active account had a live touchpoint this week. TerraFirm's asset delay was raised directly on Wednesday's call and followed up by email Thursday — no response yet.",
      },
      [
        P("Launch DryRoot Waterproofing's refreshed search campaign"),
        P('Complete GoHighLevel automation QA for Summit Basement Solutions'),
        P("Finalize TerraFirm's landing page, pending client asset delivery"),
        P('Kick off Q3 planning call with Helitech Foundation & Waterproofing'),
      ],
      'All four active accounts stayed on schedule this week. Paid social and search work moved forward on pace, GoHighLevel automation build-out for Summit is midstream, and TerraFirm’s landing page is paused pending client assets.'
    ),
  ];
}

/**
 * Phase 4: 5 daily reports (Mon-Fri, 2026-07-13..17) -- the same week as
 * `r7` above -- so the weekly wizard's "import this week's daily reports"
 * action has real data to aggregate out of the box. Friday (`d5`) is left
 * in Draft with an empty win on purpose: it exercises the aggregator's
 * "latest non-empty daily win" rule (falls back to Thursday's) and its
 * "narratives from every daily, even a short one" touchpoints join.
 */
export function seedDailyReports(): DailyReport[] {
  return [
    mkDaily(
      'd1',
      '2026-07-13',
      'Sent',
      [
        T(FF_CLIENTS[0], 'Paid social creative refresh', 'In Progress', '2026-07-17'),
        T(FF_CLIENTS[1], 'Search campaign copy testing', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[2], 'GoHighLevel pipeline automation', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[3], 'Landing page conversion audit', 'Blocked', '2026-07-17'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page work is paused. Waiting on updated project photos and testimonials, requested since June 30.',
          'Following up with the client Monday morning.'
        ),
        R(
          FF_CLIENTS[2],
          'At Risk',
          "The CRM export from Summit's previous platform is incomplete, delaying the full GoHighLevel data migration.",
          'Automation build continues on test data.'
        ),
      ],
      { stat: '4', label: 'Client touchpoints logged today', narrative: 'Kicked the week off with a check-in call on every active account.' },
      { calls: 2, emails: 3, escalations: 0, narrative: 'Monday kickoff calls with Helitech and DryRoot; async check-ins with Summit and TerraFirm.' },
      [P("Push Helitech's creative refresh live"), P("Keep pressure on TerraFirm's asset request")],
      "Monday kickoff across all four accounts. TerraFirm's landing page work remains blocked on client assets."
    ),
    mkDaily(
      'd2',
      '2026-07-14',
      'Sent',
      [
        T(FF_CLIENTS[0], 'Paid social creative refresh', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[1], 'Search campaign copy testing', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[2], 'GoHighLevel pipeline automation', 'In Progress', '2026-07-24'),
        T(FF_CLIENTS[3], 'Landing page conversion audit', 'Blocked', '2026-07-17'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page work is paused. Waiting on updated project photos and testimonials, requested since June 30.',
          'Follow-up sent Tuesday; no response yet.'
        ),
        R(
          FF_CLIENTS[2],
          'At Risk',
          "The CRM export from Summit's previous platform is incomplete, delaying the full GoHighLevel data migration.",
          'Automation build continues on test data.'
        ),
      ],
      {
        stat: '18%',
        label: "Drop in Helitech's cost-per-lead",
        narrative: "The refreshed creative went live this morning and cost-per-lead is already down 18% week over week.",
      },
      { calls: 1, emails: 2, escalations: 0, narrative: "Quick sync with Helitech on the creative launch." },
      [P("Monitor Helitech's refreshed creative performance"), P('Escalate TerraFirm asset request if no response by Thursday')],
      "Helitech's creative refresh launched and is already showing results. TerraFirm remains blocked."
    ),
    mkDaily(
      'd3',
      '2026-07-15',
      'Sent',
      [
        T(FF_CLIENTS[2], 'GoHighLevel pipeline automation', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[0], 'Monthly performance dashboard', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[1], 'Search campaign copy testing', 'In Progress', '2026-07-24'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page work is paused. Waiting on updated project photos and testimonials, requested since June 30.',
          'Escalating directly with the client this week.'
        ),
      ],
      {
        stat: '3',
        label: 'GoHighLevel automations shipped for Summit',
        narrative: "Summit's pipeline automation build wrapped a day ahead of schedule.",
      },
      { calls: 2, emails: 2, escalations: 0, narrative: 'Summit automation review call; Helitech dashboard delivered by email.' },
      [P("Kick off Q3 planning call with Helitech"), P("Finalize TerraFirm's landing page pending assets")],
      "Summit's automation build wrapped early. Helitech's new dashboard shipped. TerraFirm remains the one open blocker."
    ),
    mkDaily(
      'd4',
      '2026-07-16',
      'Sent',
      [
        T(FF_CLIENTS[1], 'Search campaign copy testing', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[3], 'Landing page conversion audit', 'Blocked', '2026-07-17'),
      ],
      [
        R(
          FF_CLIENTS[3],
          'Blocked',
          'Landing page work is paused. Waiting on updated project photos and testimonials, requested since June 30.',
          'Follow-up sent Thursday; will escalate if no response by Monday.'
        ),
        R(
          FF_CLIENTS[2],
          'At Risk',
          "The CRM export from Summit's previous platform is incomplete, delaying the full GoHighLevel data migration.",
          'Automation build finished on test data; full migration expected early next week.'
        ),
      ],
      {
        stat: '9%',
        label: "Lift in DryRoot's search click-through rate",
        narrative: "The new ad copy variant tested this week is already outperforming the control by 9%.",
      },
      { calls: 1, emails: 1, escalations: 1, narrative: "One escalation: flagged TerraFirm's asset delay directly with the client on today's call." },
      [P('Prep Helitech Q3 review'), P("Finalize TerraFirm's pending assets")],
      "DryRoot's copy test wrapped with a clear winner. One escalation today on TerraFirm's asset delay."
    ),
    mkDaily(
      'd5',
      '2026-07-17',
      'Draft',
      [
        T(FF_CLIENTS[0], 'Monthly performance dashboard', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[2], 'GoHighLevel pipeline automation', 'Complete', '2026-07-17'),
        T(FF_CLIENTS[3], 'Landing page conversion audit', 'Blocked', '2026-07-17'),
        T(FF_CLIENTS[1], 'Monthly recap prep', 'In Progress', '2026-07-24'),
      ],
      [],
      { stat: '', label: '', narrative: '' },
      { calls: 0, emails: 1, escalations: 0, narrative: 'Friday wrap-up email sent to Helitech.' },
      [],
      "Short Friday -- wrapping up the week's open items before end of day."
    ),
  ];
}

/**
 * Phase 6a: the four Projects seeded by `ff.projects.v1` on first read
 * (LocalStorageReportsRepository.getProjects()). Hardcoded verbatim from the
 * SQL insert (supabase/migrations/20260717000001_initial_schema.sql's
 * `clients` seed, renamed to `projects` in
 * supabase/migrations/20260718000003_projects.sql) -- NOT derived via
 * slugifyProjectName(), so the app seed and the SQL seed can never drift
 * apart. Do NOT touch seedReports()/seedDailyReports() above (verbatim-port
 * content) -- projectId backfill onto their tasks/risks happens lazily at
 * runtime instead (see lib/projects.ts ensureProjectIds()).
 */
export function seedProjects(): Project[] {
  return [
    { id: 'helitech-foundation-waterproofing', name: 'Helitech Foundation & Waterproofing' },
    { id: 'dryroot-waterproofing', name: 'DryRoot Waterproofing' },
    { id: 'summit-basement-solutions', name: 'Summit Basement Solutions' },
    { id: 'terrafirm-foundation-repair', name: 'TerraFirm Foundation Repair' },
  ];
}
