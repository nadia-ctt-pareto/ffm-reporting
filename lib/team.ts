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
