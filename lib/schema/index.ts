// Barrel for lib/schema/*. lib/types.ts imports its `z.infer` sources from
// here (not from the individual files directly) -- see that file's header
// comment. `./import` (Phase 6b, the CSV importer's row schemas) is
// intentionally NOT re-exported as part of the domain-type facade lib/
// types.ts consumes -- import.ts's schemas are UI-boundary-only shapes
// (an `ImportRow`'s raw string cells), not `AnyReport`/`Task`/etc.
// themselves, so lib/import.ts imports directly from './import' rather than
// through this barrel. Do NOT add lib/schema/api.ts (Phase 7) here yet --
// out of scope for Phase 6b.

export * from './report';
export * from './project';
// WP1: TeamMember follows the exact same barrel rule as Project above --
// it's a domain shape (persisted, read by lib/types.ts), not a wire-only
// shape like lib/schema/api.ts's *InputSchema variants.
export * from './team';
