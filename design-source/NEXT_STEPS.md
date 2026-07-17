# Weekly Reports Dashboard — Next Steps (Claude Code handoff)

Prototype built as a single Design Component with in-memory seed data (7 weeks, 4 clients). Below is the improvement backlog from design review, for the full build.

## Usability
- Sortable column headers on the dashboard table (click to sort) instead of a separate Sort By select.
- Bulk actions on the dashboard (select multiple reports → export CSV subset, or archive).
- "Duplicate last week" shortcut on New Report that pre-fills basics + carries forward all pending items automatically, instead of manual import per step.
- Keyboard nav for the wizard (Enter to advance, Esc to exit) and an unsaved-changes warning when exiting.
- Inline validation as-you-type (red border on required fields) rather than only on Next click.

## Design
- Trend sparkline/chart on the dashboard (e.g. tasks-on-schedule % over the last 8 weeks) in the sage/green palette.
- Client-level rollup view (tabs per client) alongside the week-level table.
- Designed empty/first-run state for the dashboard (currently always pre-seeded).
- Print/PDF layout that mirrors the original deck aesthetic (diagonal band cover, Regonia stat) instead of the mocked dialog.

## Functionality
- Deadline reminders — flag tasks/risks whose deadline has passed as "overdue" on the dashboard.
- Audit trail per report (who changed status/dates and when).
- Real client management (add/edit the client list) instead of the hardcoded 4 seed accounts.
- Real persistence layer (currently in-memory only — resets on refresh).
- Real PDF generation and real shareable-link hosting (both currently mocked/UI-only).
