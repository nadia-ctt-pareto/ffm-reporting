// WP1: pure helpers for the TeamMember entity (lib/schema/team.ts). No
// storage/React here -- mirrors the style of lib/report-utils.ts / lib/
// aggregate.ts, and specifically mirrors lib/projects.ts's Project-entity
// helpers file-for-file (same slugify-then-collision-check shape).
//
// WP2 adds a second, unrelated group of helpers at the bottom of this file
// (the assignee-picker `<Select>` helpers) -- these stay in THIS module
// (not a new file) because they're TeamMember-entity UI plumbing, same as
// everything above, just for a different consumer (Task.assigneeId's
// picker instead of the "New Team Member" dialog's name field).
//
// Deliberately a SEPARATE module, not a generalization of lib/projects.ts
// into a shared "resolveNewEntityName(rawName, existing)" helper, even
// though the two functions below are near-identical to their Project
// counterparts. Two reasons this stayed a mirror rather than an
// abstraction:
//
//   1. lib/projects.ts is documented (its own header comment, and CLAUDE.md's
//      "Layout" section) as "pure helpers for the Project entity" --
//      folding a second, unrelated entity's naming rules into it would
//      blur that file's scope to save one ~20-line function.
//   2. The two entities' collision rules are not identical today and are
//      likely to diverge further: a team member additionally carries an
//      `email` (a second, independent uniqueness axis this function does
//      NOT check -- SQL's `team_members_email_key` unique constraint is
//      the real enforcement there, surfaced via `curatedMessage`, see
//      `lib/server/reports-service.ts`), while a project has no such
//      field at all. Sharing one generic helper today would need an
//      immediate per-entity escape hatch for that difference anyway,
//      which is most of the abstraction's supposed benefit gone before it
//      ships.

import type { SelectOption } from './constants';
import { uid } from './format';
import type { TeamMember } from './types';

/** Lowercase, non-alphanumeric runs -> single '-', leading/trailing '-' trimmed. Byte-identical to lib/projects.ts's private `rawSlug` -- duplicated rather than imported, per this file's header comment (the two entities' name-validation rules are deliberately independent modules). */
function rawSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when `name` has no letters/digits at all, i.e. would slugify to `''`. Mirrors lib/projects.ts's `isBlankProjectName` -- see that function's own doc comment for why this check must run BEFORE slugifying (the slugifier itself never returns `''`, so checking its output could never observe this case). */
export function isBlankTeamMemberName(name: string): boolean {
  return rawSlug(name) === '';
}

/** Mirrors lib/projects.ts's `slugifyProjectName` -- never returns `''` (falls back to a fresh `uid()` for a name with no letters/digits at all, defense in depth; callers are expected to reject that case with `isBlankTeamMemberName` first, same posture as the Project sibling). */
export function slugifyTeamMemberName(name: string): string {
  return rawSlug(name) || uid('team');
}

/** The shape `resolveNewTeamMemberName` below returns -- `error` set means `name` can't be used as typed. Mirrors lib/projects.ts's `ProjectNameResolution`. */
export interface TeamMemberNameResolution {
  id: string;
  name: string;
  error?: string;
}

/**
 * Deliberately near-identical to lib/projects.ts's `resolveNewProjectName`
 * -- see this file's header comment for why it stayed a mirror rather than
 * a shared abstraction. Same shape/semantics: blank input -> `null`
 * (nothing typed yet, not an error); a name that slugifies to an EXISTING
 * member's id -> an error (exact-name collision -> "rename that entry
 * instead"; near-name collision, e.g. a casing/punctuation variant -> "would
 * collide with ..."); anything else -> a fresh `{ id, name }`. Does NOT
 * check `email` uniqueness -- that's SQL's `team_members_email_key`, backed
 * by a curated server error (`lib/server/reports-service.ts`'s
 * `curatedMessage`), since this function only ever runs against whatever
 * `members` the caller already has loaded (which may be empty/stale before
 * the mutation round-trips) and email collision is a write-time concern,
 * not a pre-flight one, for this package.
 */
export function resolveNewTeamMemberName(rawName: string, members: TeamMember[]): TeamMemberNameResolution | null {
  const name = rawName.trim();
  if (!name) return null;
  if (isBlankTeamMemberName(name)) {
    return { id: '', name, error: 'Name must contain at least one letter or number.' };
  }
  const id = slugifyTeamMemberName(name);
  const existingById = members.find((m) => m.id === id);
  if (existingById) {
    return existingById.name === name
      ? { id, name, error: `"${name}" already exists -- rename that entry instead of creating a new one.` }
      : {
          id,
          name,
          error: `"${name}" would collide with the existing member "${existingById.name}" -- use a more distinct name.`,
        };
  }
  return { id, name };
}

// =============================================================================
// WP2: assignee-picker helpers, shared by `components/tasks/TaskDialog.tsx`
// and `components/wizard/steps/StepTasks.tsx`'s `TaskRow` -- both need the
// exact same "team member <Select>, with an Unassigned option" behavior, and
// deriving it twice would risk the option list/sentinel value drifting
// between the two surfaces (the plan's own "must be reachable in both
// surfaces" requirement).
// =============================================================================

/**
 * Radix `Select.Item` rejects an empty-string `value` outright (it reserves
 * `''` for "nothing selected" internally) -- so "Unassigned" needs a real,
 * non-empty sentinel, not `Task.assigneeId`'s own `''`/`undefined`/`null`
 * "unassigned" convention. Mirrors `CsvImportSection.tsx`'s identical
 * `HOUSE_VALUE` sentinel for its "No project (house reports)" option --
 * same reasoning, different picker.
 */
export const UNASSIGNED_VALUE = '__unassigned__';

/** `<Select>` options for an assignee picker: "Unassigned" first, then every team member by name. */
export function assigneeSelectOptions(members: TeamMember[]): SelectOption[] {
  return [{ value: UNASSIGNED_VALUE, label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.name }))];
}

/** The `<Select>`'s displayed value for a task's current `assigneeId` -- `UNASSIGNED_VALUE` when unset (`''`/`null`/`undefined`, matching `Task.assigneeId`'s own convention, see lib/schema/report.ts). */
export function assigneeSelectValue(assigneeId: string | null | undefined): string {
  return assigneeId || UNASSIGNED_VALUE;
}

/** Inverse of `assigneeSelectValue` -- what to WRITE back to `Task.assigneeId` when the `<Select>` changes: `undefined` (unassigned) for the sentinel, the picked member's id otherwise. */
export function resolveAssigneeId(selectValue: string): string | undefined {
  return selectValue === UNASSIGNED_VALUE ? undefined : selectValue;
}

// =============================================================================
// WP7 (Prepared By/For directory pickers): `StepBasics.tsx`'s (and, for
// Prepared For only, `ReportScreen.tsx`'s) "who is this report prepared
// for/by" fields switch from free-text `Input`s to `<Select>`s sourced from
// the team directory.
//
// LOCKED DESIGN DECISION: both fields keep storing a plain name STRING
// chosen from the directory, exactly like today -- NOT a foreign key. No
// schema change, no migration. `preparedBy`/`preparedFor` are historical
// attribution printed on a deck that was already sent to a client --
// "Prepared by Jordan Reyes" must stay exactly that even if Jordan's
// directory name is corrected later, the same principle Phase 8c locked for
// `task.client`/`risk.client` (CLAUDE.md, "Project (client) management" --
// "THE CRUX -- rename safety"). The operational link that genuinely needs an
// FK is `Task.assigneeId` above, which already is one.
//
// THE LOAD-BEARING RISK these helpers exist to prevent: a `<Select>` whose
// `options` don't include its current `value` renders with nothing visibly
// selected, and -- because this app's Selects are always controlled, not
// native `<select>`s with a stray browser-remembered value -- the NEXT time
// the surrounding form writes the draft/patch back out, it writes whatever
// the (apparently-unselected) Select currently holds, silently discarding
// whatever free-text value was there before. Reports already exist with
// values that are NOT in the directory and never will be: the seed data's
// `preparedFor: 'Christene, Founder'` (a CLIENT contact -- prepared FOR a
// client is never a Foundation First team member, see seedTeamMembers'
// own doc comment), CSV-imported rows, and MCP tool writes (`create_report`/
// `update_report` accept any string for either field, no directory
// validation). Every option-builder below appends the CURRENT value verbatim
// as a selectable, visually-marked-as-not-a-directory-entry option whenever
// it isn't an exact match for a member's name -- so opening an existing
// report and saving it again without touching this field round-trips it
// byte-identical, and a deliberate change away from it is still one click.
// =============================================================================

/**
 * Resolves whether the "Prepared By" field should be a locked, read-only
 * field (a plain member can only ever prepare THEIR OWN report) or an
 * ordinary directory `<Select>` (a pm/admin, or a user this app can't
 * resolve to a directory row at all -- including demo mode, which has no
 * session concept whatsoever, see `useSession`'s own doc comment).
 *
 * Returns the resolved member's OWN `name` (a plain string, matching the
 * locked design decision above -- this is what `useWizard.ts`'s own effect
 * stamps onto `draft.preparedBy`, and what `StepBasics.tsx` renders
 * read-only with a hint) when ALL of the following hold: the caller is NOT
 * pm/admin-ranked (`hasRoleAtLeast(user, 'pm')`, lib/roles.ts -- the REAL
 * permission boundary; a `TeamMember.role` directory label is never
 * consulted here, see lib/schema/team.ts's own header comment on why the two
 * must never be confused), `currentUserId` is set (a resolved session), AND
 * `members` (the loaded team directory) contains a row whose `userId` was
 * linked to that same id via `public.link_my_team_member()`.
 *
 * Returns `null` (render the ordinary dropdown instead) for a pm/admin
 * caller, an unresolved/absent user, OR while `members` is still loading
 * (`null`) -- a still-resolving directory can never be searched, so this
 * deliberately does NOT distinguish "still loading" from "resolved to no
 * match" the way `StepBasics.tsx`'s OWN "fall back to a plain Input" gate
 * does for the dropdown itself; that distinction matters for avoiding an
 * empty dropdown flash, not for this lock decision, which degrades safely to
 * "no lock yet" either way.
 */
export function resolvePreparedByAutoFill(
  members: TeamMember[] | null,
  currentUserId: string | null | undefined,
  isPmOrAdmin: boolean
): string | null {
  if (isPmOrAdmin || !currentUserId || !members) return null;
  const mine = members.find((m) => m.userId === currentUserId);
  return mine ? mine.name : null;
}

/** The suffix every legacy/off-directory preserved option is labeled with (see this section's header comment) -- shared by both `preparedForSelectOptions` and `preparedBySelectOptions` so the two fields can never describe this case in two different words. */
function offDirectoryLabel(name: string): string {
  return `${name} (not in the team directory)`;
}

/**
 * `<Select>` options for the "Prepared For" dropdown -- always rendered as a
 * dropdown (unlike Prepared By, there is no plain-member lock for this
 * field: anyone drafting a report may name any client contact it's prepared
 * for). One option per team member (`value === label === member.name`, per
 * the locked design decision above), plus -- if `currentValue` is non-blank
 * and doesn't exactly match any member's name -- that value preserved
 * verbatim and visually marked (`offDirectoryLabel`), first in the list so
 * it's immediately visible rather than buried among real directory rows.
 *
 * Deliberately NO explicit blank/"—" option: `validateStep` (lib/
 * report-utils.ts) rejects a blank Prepared For before the wizard will move
 * past step 1, so offering a selectable "—" here would just reintroduce a
 * state the very next click already refuses -- see this file's header
 * comment on `PREPARED_BY_UNSET_VALUE` for why Prepared BY, which has no
 * such check, needs the opposite answer.
 */
export function preparedForSelectOptions(members: TeamMember[], currentValue: string): SelectOption[] {
  const options: SelectOption[] = members.map((m) => ({ value: m.name, label: m.name }));
  if (currentValue.trim() !== '' && !members.some((m) => m.name === currentValue)) {
    options.unshift({ value: currentValue, label: offDirectoryLabel(currentValue) });
  }
  return options;
}

/**
 * Sentinel for the "Prepared By" dropdown's blank/"—" option. Radix
 * `Select.Item` rejects an empty-string `value` outright (see
 * `UNASSIGNED_VALUE`'s identical doc comment above) -- so, unlike Prepared
 * For, Prepared By's dropdown (shown only to a pm/admin, or when the
 * signed-in user can't be resolved to a directory row -- see
 * `resolvePreparedByAutoFill`) needs a real sentinel for "leave it unset".
 * This is genuinely needed here and NOT for Prepared For: `validateStep`
 * has no non-blank check for Prepared By at all, so blank is a legitimate,
 * already-reachable value today (a free-text field can always be cleared) --
 * removing the ability to select "—" would silently make a previously-
 * optional field mandatory, which the plan this shipped against explicitly
 * forbids changing.
 */
export const PREPARED_BY_UNSET_VALUE = '__prepared_by_unset__';

/**
 * `<Select>` options for the "Prepared By" dropdown (pm/admin, or an
 * unresolved user -- a plain member instead gets the locked, read-only field
 * `resolvePreparedByAutoFill` decides, never this dropdown at all). `"—"`
 * (`PREPARED_BY_UNSET_VALUE`) first, then every team member by name, then --
 * same off-directory preservation `preparedForSelectOptions` does above --
 * `currentValue` verbatim and marked, if it's non-blank and not an exact
 * match for any member's name.
 */
export function preparedBySelectOptions(members: TeamMember[], currentValue: string): SelectOption[] {
  const options: SelectOption[] = [{ value: PREPARED_BY_UNSET_VALUE, label: '—' }, ...members.map((m) => ({ value: m.name, label: m.name }))];
  if (currentValue.trim() !== '' && !members.some((m) => m.name === currentValue)) {
    options.push({ value: currentValue, label: offDirectoryLabel(currentValue) });
  }
  return options;
}

/** The `<Select>`'s displayed value for the current `draft.preparedBy` -- `PREPARED_BY_UNSET_VALUE` when blank, matching `preparedBySelectOptions`' sentinel item (mirrors `assigneeSelectValue` above). */
export function preparedBySelectValue(currentValue: string): string {
  return currentValue.trim() === '' ? PREPARED_BY_UNSET_VALUE : currentValue;
}

/** Inverse of `preparedBySelectValue` -- what to WRITE back to `draft.preparedBy`: `''` (unset) for the sentinel, the picked value otherwise (mirrors `resolveAssigneeId` above). */
export function resolvePreparedByValue(selectValue: string): string {
  return selectValue === PREPARED_BY_UNSET_VALUE ? '' : selectValue;
}
