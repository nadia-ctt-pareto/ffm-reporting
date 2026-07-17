// Verbatim TS port of design-source/original-dashboard.dc.html script block,
// ffSeedReports() (lines 449-506). Exact strings, dates, statuses, tasks,
// risks, wins, touchpoints, and priorities are preserved as-authored,
// including curly apostrophes (') and en/em dashes (– / —) where
// the prototype used them.

import { FF_CLIENTS } from './constants';
import { uid } from './format';
import type { Priority, Report, Risk, Task } from './types';

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
): Report {
  return {
    id,
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

function T(client: string, task: string, status: Task['status'], deadline: string): Task {
  return { id: uid('t'), client, task, status, deadline };
}

function R(client: string, severity: Risk['severity'], description: string, nextStep: string): Risk {
  return { id: uid('rk'), client, severity, description, nextStep };
}

function P(text: string): Priority {
  return { id: uid('p'), text };
}

/** Line 449-506 */
export function seedReports(): Report[] {
  return [
    mk(
      'r1',
      '2026-06-01',
      '2026-06-05',
      'Sent',
      [
        T(FF_CLIENTS[0], 'Paid social campaign launch', 'Complete', '2026-06-05'),
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
        T(FF_CLIENTS[1], 'Copy testing wrapped', 'Complete', '2026-07-10'),
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
