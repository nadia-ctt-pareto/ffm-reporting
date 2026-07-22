---
name: weekly-reports
description: Read and write Foundation First Marketing's weekly/daily client status reports through the app's remote MCP server -- use this whenever the user asks to check, summarize, draft, roll up, or create a weekly or daily report, list reports/projects, or consolidate daily reports into a weekly one.
---

# Weekly Reports Dashboard

This Skill drives Foundation First Marketing's internal weekly-reporting app
through its remote MCP server (`/api/mcp`). Read it before calling any tool
in this connector -- it explains the data model, what you're allowed to do,
and how each write is expected to behave.

## Distribution

Copy or symlink this directory into `.claude/skills/weekly-reports/` for
Claude Code; zip and upload `skills/weekly-reports/` for claude.ai.

## Domain model

A **report** is either:

- **Weekly** (`kind: "weekly"`) -- covers a Monday-Sunday week (`weekStart`/
  `weekEnd`, both `yyyy-mm-dd`). One PM's status update for one week.
- **Daily** (`kind: "daily"`) -- covers a single calendar day (`date`,
  `yyyy-mm-dd`). **One per day, covering ALL clients** -- not one per
  client. Daily reports exist so a rolling week's worth of them can be
  rolled up into a weekly draft (see "Merge semantics" below).

Every report has the same shape otherwise: `status` (`"Draft" | "Final" |
"Sent"`), `preparedFor` / `preparedBy` (free text), a `summaryNarrative`,
arrays of `tasks` / `risks` / `priorities`, a `win` (`{stat, label,
narrative}`), and `touchpoints` (`{calls, emails, escalations,
narrative}`).

- **Task**: `{client, task, status: "Complete"|"In Progress"|"Blocked",
  deadline}`.
- **Risk**: `{client, severity: "Blocked"|"At Risk", description,
  nextStep}`.
- **Priority**: `{text}` -- a next-week priority (weekly) or a next-day one
  (daily).

**Weekly and daily reports are PRESENTED differently, so write them
differently.** They share the field shape above, but the app renders each
kind with its own section structure, and content written for the wrong one
reads off:

| Field | Weekly reads as | Daily reads as |
| --- | --- | --- |
| `summaryNarrative` | "This Week" -- the week's arc | "Day at a Glance" -- what happened today |
| `tasks` | "Task Status", one flat list | "Tasks by Client", GROUPED by the `client` string |
| `risks` | "Risks & Blockers" | "Blockers Needing Attention" -- today's obstacles |
| `priorities` | "Next Week's Priorities" | "Tomorrow & Follow-Ups" |
| `win` | always shown | shown ONLY if a win was actually recorded |

Two things follow from this:

- On a **daily**, the `client` string is doing structural work, not just
  labelling -- tasks are grouped by it. Keep it consistent across a day's
  tasks (`"NC Water"` on every one of that client's tasks, never
  `"NC Water"` on one and `"NC water"` on the next), or one client will
  render as two groups.
- **Never invent a win for a daily report.** Leave `win` empty (`{stat: "",
  label: "", narrative: ""}`) when the day genuinely had no standout
  result; the app omits the slide entirely. A manufactured win is worse
  than no win, and the omission is a designed behaviour, not a gap.

**Report length is no longer constrained by the export.** A long task list
used to be silently clipped out of the exported PDF; the deck now paginates,
so a report with forty tasks exports every one of them across as many pages
as it needs. Do not trim, summarise, or drop tasks/risks/priorities to "fit"
the deck -- record what actually happened.

**Dates are always plain `yyyy-mm-dd` strings** -- never construct or
compare them with JavaScript `Date` math; treat them as opaque, sortable
strings (they compare correctly lexicographically).

**Projects and the "house" bucket.** A `project` is `{id, name}` -- a
client/engagement this agency tracks separately. A report's `projectId` is
optional metadata: `null`/absent means a "house" report (the default for
anything created through this connector or the web wizard, covering
whichever clients are mentioned in its tasks/risks by free-text `client`
name). A report with `projectId` set was imported for that specific
project. **One daily report per day, per bucket**: two daily reports can
share the same `date` only if they belong to different buckets (different
`projectId`, or one house + one project-scoped) -- `create_report` and
`create_weekly_from_dailies` will surface a conflict error if you try to
violate this; there is no way to work around it other than picking a
different date or project.

## Access model

- **Reads are org-wide.** `list_reports`, `get_report`, `list_projects`, and
  `get_week_rollup` return every report/project in the organization, not
  just ones you (the token's owner) created -- this mirrors the web
  dashboard exactly, which every signed-in teammate can browse in full.
  This is intentional, not a leak -- don't treat a report by someone else
  showing up in a list as anything unusual.
- **Writes are owner-only.** `create_report`, `update_report`,
  `create_project`, and `create_weekly_from_dailies` can only create rows
  you own or edit rows you already own. Attempting to edit someone else's
  report returns a clear "you don't have permission" error -- there is no
  way around this, including for an admin's token (see below).
- **MCP tokens are never admin, even for an admin user.** A token minted
  from an admin's account still only acts as a plain member for every write
  -- it can read everything (same as any token) but can only write its own
  rows. If the user needs to edit someone else's report, tell them to do it
  in the web app while signed in as that report's owner, or ask that person
  to grant access another way -- do not suggest routing around this Skill.
- **There is no delete tool, and this Skill never promises deletion.** Do
  not attempt to "delete" a report by clearing its fields via
  `update_report` -- that produces a confusing, hollowed-out report instead
  of an honest "I can't do that."

  The web app itself CAN delete a report (this is new): the report's own
  screen and each row of the Weekly/Daily lists have a Delete control,
  gated to the report's owner or an admin, and it removes the report's
  tasks, risks and priorities with it and stops any share link to it from
  resolving. So when a user asks you to delete something, give them that
  concrete route -- "open the report in the app and use Delete, or delete it
  from the row in the Weekly list" -- rather than a bare refusal. The
  capability is deliberately absent from THIS connector, not from the
  product.
- **Tokens can be revoked instantly** from `/settings` in the web app. If a
  call ever returns a 401/"invalid token" style error, tell the user their
  token may have been revoked or expired and to create a new one there.

## Tool reference

All 8 tools below are the complete surface -- there are no others, and
`delete_report` does not exist. Every write tool validates a bounded input
shape server-side (length/count caps); an oversized payload is rejected
with a clear error, not silently truncated.

### Read tools

**`list_reports`** -- `{kind?, prepared_for?, week_start_from?,
week_start_to?, limit?}` (limit defaults to 20, capped at 100).
`prepared_for` matches exactly, ignoring case/leading-trailing whitespace.
`week_start_from`/`week_start_to` bound the report's own period start
(`weekStart` for weekly, `date` for daily). Returns summaries (id, kind,
period, status, preparedFor/By, projectId, task/risk counts, on-schedule
stats, `updatedAt`) sorted by period end, most recent first -- not the full
report body. Use this to find candidates before calling `get_report`.

**`get_report`** -- `{id}`. Returns the full report (all tasks/risks/
priorities/win/touchpoints) plus `updatedAt`, which you need verbatim for
`update_report`'s CAS check below. Returns a clear "not found" error for an
unknown id.

**`list_projects`** -- `{}`. Returns every `{id, name}`.

**`get_week_rollup`** -- `{week_start}` (must be a Monday, `yyyy-mm-dd`;
anything else is rejected with an instructive error). **Read-only preview**
-- merges every weekly and daily report that overlaps that week (see
"Merge semantics" below) and returns `{week_start, week_end, sources,
rollup, merge_log}` WITHOUT persisting anything. Use this to show the user
what a roll-up would look like before calling `create_weekly_from_dailies`.

### Write tools

**`create_report`** -- kind-discriminated: pass `kind: "weekly"` with
`week_start`/`week_end`, or `kind: "daily"` with `date`, plus
`prepared_for`, `prepared_by`, optional `status` (defaults `"Draft"`),
`summary_narrative`, `tasks`/`risks`/`priorities` arrays, `win`,
`touchpoints`, and `project_id`. **Never pass an id** -- one is always
generated. If you already own a report of the same kind/period/
`prepared_for`, this is refused with the existing report's id unless you
pass `allow_duplicate: true` -- treat that refusal as a signal to check
whether the user actually meant `update_report` instead.

**`update_report`** -- `{id, expectedUpdatedAt, ...patch}`. **REQUIRES
`expectedUpdatedAt`** -- always call `get_report` first and pass its
`updatedAt` back unchanged; a stale value is refused with a conflict error
(re-`get_report` and retry with the fresh value). A patch field you include
replaces that field wholesale -- a `tasks` array you pass replaces the
WHOLE task list, it does not merge with the existing one, so when editing
just one task, build the full array (existing tasks plus your change) from
what `get_report` returned, not just the one task you're changing.

**Never demote a report's `status` as a side effect.** The lifecycle runs
`"Draft"` -> `"Final"` -> `"Sent"`, and it only ever moves forward unless
the user explicitly asks otherwise. If you are correcting the content of a
report that is already `"Final"` or `"Sent"`, either omit `status` from the
patch entirely (leaving it untouched is the safe default) or pass back the
exact value `get_report` returned. Silently writing `"Draft"` onto a report
someone already sent to a client is a real, visible mistake -- the web
wizard had exactly that bug and it was fixed deliberately; do not
reintroduce it from this side.

**Casing note**: every OTHER tool in this connector takes snake_case input
(`week_start`, `prepared_for`, `allow_duplicate`, ...) -- `update_report`
alone takes **camelCase** (`id`, `expectedUpdatedAt`, `preparedFor`,
`summaryNarrative`, `weekStart`, ...), because it reuses the exact same
patch schema the web app's own edit screen writes through. This is a real
asymmetry, not a typo -- if a call to `update_report` is rejected for an
unrecognized/missing field, check that you used camelCase, not the
snake_case shape the other tools use.

**`create_project`** -- `{name}`. Idempotent by name (exact match, case/
whitespace-insensitive) -- calling this again with a name that already
exists just returns that project, it never creates a duplicate.

**`create_weekly_from_dailies`** -- `{week_start, prepared_for?,
prepared_by?}` (`week_start` must be a Monday). Rolls up the DAILY reports
for that week into a brand-new `"Draft"` weekly report and persists it --
**unlike `get_week_rollup`, which also folds in any existing weekly report
for the week, this tool merges dailies ONLY.** Since reads are org-wide, a
teammate's weekly report overlapping the target week will show up in
`get_week_rollup`'s preview `sources`, but this tool will NOT fold it in --
the persisted draft reflects the dailies, not other people's weeklies.
Don't assume the two tools produce the same content; if you previewed with
`get_week_rollup` and it included a weekly source, say so before calling
this tool, since the actual create will diverge from what was previewed.
Refused (with the existing id) if you already own a weekly report for that
week, and refused if there are zero daily reports to roll up -- either way,
nothing is created.

### CAS / read-before-write discipline

`update_report`'s `expectedUpdatedAt` requirement exists specifically
because you have no UI to "reload and see it changed" -- always read before
you write. The expected workflow is: `get_report` -> show the user what you
found -> get their confirmation on the change -> `update_report` with the
`updatedAt` you just read. If a write is refused for a conflict, that means
someone else changed the report since you read it -- re-read and re-confirm
with the user rather than silently retrying with a forced value.

## Merge semantics (roll-ups)

`get_week_rollup` and `create_weekly_from_dailies` merge their sources
using the exact same rules the web app's own weekly-import and
consolidation features use (`lib/aggregate.ts`) -- but their SOURCE SETS
differ (see `create_weekly_from_dailies` above): `get_week_rollup` merges
every weekly AND daily report overlapping the Monday-anchored week;
`create_weekly_from_dailies` merges the DAILY reports for that week only.
The merge rules below apply identically to whichever sources a given call
actually has:

- Sources are processed oldest-to-newest by period end; on an exact tie, a
  daily report outranks a weekly one (fresher-grained information about the
  same date wins).
- **Tasks** dedupe by `(client, task)` -- the LATEST source's version
  (status, deadline) wins.
- **Risks** dedupe by `(client, description)` -- the LATEST source's
  version (severity, next step) wins.
- **Priorities** dedupe by exact text -- the FIRST source to introduce a
  given priority wins (there's no "version" to prefer between two
  identical priorities).
- **Touchpoints** (calls/emails/escalations) SUM across every source;
  narratives join with newlines.
- **The win** carries from the latest source that has a non-empty one --
  but never overwrites a win already present in the seed draft.

The `merge_log` in both tools' output lists exactly which keys collapsed
and which source each kept version came from -- surface this to the user
(at least a summary count) before persisting, so they can catch a
surprising dedupe before it lands.

## Workflows

Each of these should end with a user-visible summary of what you're about
to write, and an explicit confirmation, BEFORE the write tool call --
server-side guards (duplicate refusal, CAS) are the hard floor, not a
substitute for asking first.

1. **Draft this week's report from daily reports.** Call `get_week_rollup`
   for the target week. Summarize the tasks, risks, and priorities you
   found (and call out anything the merge log deduped) -- if any `sources`
   entry is a weekly report, say so explicitly and note that
   `create_weekly_from_dailies` will NOT include it (dailies only, see
   "Tool reference" above), so the persisted draft will be smaller than the
   preview in that case. Show that summary to the user and ask them to
   confirm before calling `create_weekly_from_dailies`.
2. **Weekly status digest.** Call `list_reports` filtered to
   `prepared_for`, take the most recent result, `get_report` it, then write
   a 3-4 sentence status digest (on-schedule tasks, open blockers, the
   week's win) suitable for pasting into an email. No write involved.
3. **Blocker triage across N weeks.** Call `list_reports` for the trailing
   window, `get_report` each, and collect every task/risk marked
   `"Blocked"`. Group by client and flag anything recurring across more
   than one consecutive week. No write involved.
4. **Consolidate a week across projects.** Call `list_projects`, then
   `list_reports` scoped to each project for the target week, `get_report`
   each result, and produce one consolidated narrative (overall progress,
   top risks across all projects, one combined win). No write involved --
   if the user wants this actually saved as a report, that's a
   `create_report` call built from what you found, following the
   duplicate-guard flow above.
5. **CSV import assistance.** This connector does not import CSVs itself
   (that's a web-app-only feature at `/settings`) -- if a user wants to
   bring in a CSV of reports, help them map their source data onto the
   app's documented column contract (visible on `/settings`'s CSV Import
   Templates), then tell them to upload it there. Do not attempt to
   recreate that import via repeated `create_report` calls from spreadsheet
   rows -- it skips the app's own dedupe/validation.

## Voice

Foundation First's house voice (`HOUSE_VOICE`, `lib/prompts.ts`) is the
same voice the app's own "Polish" button uses to rewrite prose fields
(`lib/server/ai-polish.ts`) -- match it here too, so a report drafted or
edited through this connector reads no differently from one polished or
hand-written in the web app: concise, concrete, client-appropriate; plain
business English, active voice, specific outcomes and numbers over vague
adjectives; no corporate filler ("I'm pleased to report", "as previously
mentioned", "moving forward"), no hype, no exclamation marks, no internal
jargon a client wouldn't recognize. Applies to `summaryNarrative`,
`win.narrative`, and `touchpoints.narrative`. When in doubt, also mirror
the phrasing style of the most recent report for the same `prepared_for`.
