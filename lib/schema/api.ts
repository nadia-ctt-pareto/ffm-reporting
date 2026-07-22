// Phase 7b (M1): transport-layer (request/response) Zod schemas for the
// `/api/reports*` and `/api/projects` route handlers (lib/server/
// reports-service.ts's callers). Deliberately NOT re-exported through
// lib/schema/index.ts -- see that barrel's own comment ("Do NOT add lib/
// schema/api.ts here yet"). These are wire shapes, not domain shapes:
// nothing under components/ or lib/types.ts should ever import from here,
// and this file changing never triggers the "Migrations discipline" rule in
// CLAUDE.md (no lib/types.ts domain shape is affected).
//
// Every request body is validated against the `*InputSchema` variants from
// lib/schema/report.ts -- NEVER the row schemas (`ReportCoreSchema`/
// `AnyReportSchema`). See that file's header comment and docs/
// database-schema.md's "Cutover checklist": this is the choke point that
// strips a client-supplied `ownerId`/`shareToken` before it ever reaches
// lib/server/reports-service.ts. `ownerId` is additionally re-derived
// server-side (RLS + `replace_reports`'s own `auth.uid()` default), and
// `shareToken` can only ever be written by `enable_report_share`/
// `revoke_report_share` -- neither is reachable through this schema at all.

import { z } from 'zod';
import { POLISH_FIELD_IDS } from '../prompts';
import { isoDate, AnyReportInputSchema, ReportCoreInputSchema } from './report';
import { ProjectSchema } from './project';
import { TeamMemberSchema } from './team';

/** `POST /api/reports` body -- one batch write, mapped 1:1 onto a single `replace_reports` RPC call (see lib/server/reports-service.ts's `upsertReports`). Bounded at 1000 so a pathological body can't hang the RPC/transaction indefinitely. */
export const UpsertReportsRequestSchema = z.object({
  reports: z.array(AnyReportInputSchema).min(1).max(1000),
  /** Mirrors `replace_reports(payload, skip_existing)`'s second argument -- see the Settings local-data-import UI (Phase 7b M4) and the CSV importer's re-run-safety story. */
  skipExisting: z.boolean().optional(),
});
export type UpsertReportsRequest = z.infer<typeof UpsertReportsRequestSchema>;

export const UpsertReportsResponseSchema = z.object({
  imported: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type UpsertReportsResponse = z.infer<typeof UpsertReportsResponseSchema>;

/**
 * `PATCH /api/reports/[id]` body. Built from `ReportCoreInputSchema` (never
 * the row schema -- `ownerId`/`shareToken` stay unreachable here too) with
 * `id`/`createdAt`/`updatedAt` dropped (`id` comes from the URL; `createdAt`
 * is immutable; `updatedAt` is server-stamped -- see reports-service.ts's
 * `updateReport`) and every remaining field made optional (a patch, not a
 * full report; a present `tasks`/`risks`/`priorities` array still replaces
 * the whole list, per `ReportsRepository.update`'s existing "child arrays
 * replaced wholesale when present" contract -- `.partial()` only loosens
 * the TOP-level keys, so an individual task/risk/priority inside a
 * provided array is still fully validated). `kind` is unpatchable BY
 * CONSTRUCTION: `ReportCoreSchema` has no `kind` field at all (only
 * `WeeklyReportSchema`/`DailyReportSchema` add it) -- there is nothing to
 * `.omit()`; a body carrying `kind` is just an unknown key, stripped like
 * any other. `weekStart`/`weekEnd`/`date` are added back explicitly
 * (optional) since `ReportCoreInputSchema` doesn't carry either kind's
 * period fields. `expectedUpdatedAt` (optional) is the optimistic-
 * concurrency CAS value -- see `reports-service.ts`'s `updateReport`; the
 * route handler splits it back out of the parsed body before calling the
 * service (it is not itself a `ReportCore` field). Post-review hardening
 * round 2 (SHOULD-FIX C): this is the DOMAIN-normalized `updatedAt` string
 * (`yyyy-mm-dd`, `toDomainTimestamp`-sliced) -- i.e. exactly what a prior
 * `GET`/list response returned for this report's `updatedAt` field -- NOT
 * the raw, full-precision `updated_at` timestamptz Postgres stores. The
 * raw value was never something any client could have seen (every read
 * path normalizes it before it ever reaches JSON), which made this CAS
 * permanently unsatisfiable before this fix; comparing against the
 * domain-normalized value trades sub-day precision for the CAS actually
 * being usable by a real caller.
 */
export const ReportPatchSchema = ReportCoreInputSchema.partial()
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    weekStart: isoDate.optional(),
    weekEnd: isoDate.optional(),
    date: isoDate.optional(),
    expectedUpdatedAt: z.string().optional(),
  });
export type ReportPatch = z.infer<typeof ReportPatchSchema>;

/** `POST /api/projects` body. `Project` (`lib/schema/project.ts`) has no server-only fields to strip -- this alias exists purely so route handlers import a `*InputSchema`-named symbol for every request body, matching the convention above. */
export const ProjectInputSchema = ProjectSchema;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

/**
 * Phase 8c: `PATCH /api/projects/[id]` body -- a rename touches EXACTLY the
 * `name` field (never `id`, which comes from the URL and is immutable here
 * by construction: there is nothing in this schema to even carry a
 * client-supplied `id` through). Reuses `ProjectSchema.shape.name` rather
 * than redeclaring `z.string().min(1).max(500)` so the two can never drift.
 * Mirrors `supabase/migrations/20260724000011_project_management.sql`'s
 * column-level grant (`authenticated` may only UPDATE `projects.name`) --
 * this schema is the application-layer twin of that SQL-layer guarantee.
 */
export const ProjectRenameInputSchema = z.object({ name: ProjectSchema.shape.name });
export type ProjectRenameInput = z.infer<typeof ProjectRenameInputSchema>;

/** WP1: `POST /api/team` body. Same "no server-only fields to strip" shape as `ProjectInputSchema` above -- `TeamMemberSchema` has none either (`userId` is never client-supplied for a CREATE; the route only ever calls `ensureTeamMember`, which never writes that column -- see `lib/server/reports-service.ts`). */
export const TeamMemberInputSchema = TeamMemberSchema;
export type TeamMemberInput = z.infer<typeof TeamMemberInputSchema>;

/**
 * WP1: `PATCH /api/team/[id]` body -- a rename touches EXACTLY the `name`
 * field, mirroring `ProjectRenameInputSchema` immediately above (same
 * rationale: `id` comes from the URL and there is nothing in this schema to
 * even carry a client-supplied one; `role`/`email`/`userId` edits are out
 * of scope for this package -- see `lib/team.ts`'s header comment on why
 * `renameTeamMember` stays name-only, matching `renameProject`'s own
 * narrow contract).
 */
export const TeamMemberRenameInputSchema = z.object({ name: TeamMemberSchema.shape.name });
export type TeamMemberRenameInput = z.infer<typeof TeamMemberRenameInputSchema>;

/** Shape of every non-2xx JSON body a route handler under `app/api/**` returns. `issues` (present only on a 400 from a failed Zod parse) is `ZodIssue[]`, typed loosely here since it's diagnostic-only -- no caller in this phase branches on its shape. */
export interface ApiErrorBody {
  error: string;
  issues?: unknown;
}

// =============================================================================
// Phase 7c (BYOK AI polish): `/api/ai/key` and `/api/ai/polish` transport
// schemas. Same placement rule as everything above -- wire shapes only,
// deliberately NOT re-exported through lib/schema/index.ts (see that
// barrel's own comment). `PolishFieldIdSchema` is built from
// `lib/prompts.ts`'s `POLISH_FIELD_IDS` array (not re-declared here) so the
// transport schema and the per-field prompt registry can never drift apart.
// =============================================================================

export const PolishFieldIdSchema = z.enum(POLISH_FIELD_IDS);

/**
 * Small, bounded context object sent alongside the field text -- NOT the
 * whole report (see `lib/server/ai-polish.ts`'s doc comment for why: token
 * cost and data-sharing surface, for little single-field quality gain).
 * Every string is capped at 120 chars -- generous for a period label, a
 * client name, or a single enum value, nowhere near a paragraph. `.strict()`
 * so an unrecognized key is rejected outright rather than silently dropped
 * -- this object's whole point is to stay small and enumerated.
 */
export const PolishContextSchema = z
  .object({
    kind: z.enum(['weekly', 'daily']).optional(),
    period: z.string().max(120).optional(),
    client: z.string().max(120).optional(),
    severity: z.string().max(120).optional(),
    status: z.string().max(120).optional(),
  })
  .strict();
export type PolishContext = z.infer<typeof PolishContextSchema>;

/**
 * `POST /api/ai/polish` body. `text` is capped at 4,000 chars (CLAUDE.md's
 * Phase 7c abuse-control caps) -- `components/ai/usePolishField.ts` also
 * enforces this client-side before ever issuing the request, so an
 * oversized paste never leaves the browser.
 */
export const PolishRequestSchema = z.object({
  field: PolishFieldIdSchema,
  text: z.string().min(1).max(4000),
  context: PolishContextSchema.optional(),
});
export type PolishRequest = z.infer<typeof PolishRequestSchema>;

/** `POST /api/ai/polish` response -- read path, no `.max()` needed. */
export interface PolishResponse {
  polished: string;
}

// =============================================================================
// BYOK generalization: any provider, not just Anthropic. Two provider modes
// cover essentially every provider -- `anthropic` (native Messages API,
// unchanged from the original Phase 7c behavior) and `openai_compatible`
// (the OpenAI Chat Completions request/response shape, which OpenRouter,
// OpenAI itself, Groq, Together, DeepSeek, Mistral, and most other hosted
// LLM providers all implement). See `lib/server/ai-polish.ts`'s two request
// builders and `lib/server/ssrf.ts` (the `base_url` is user-controlled for
// `openai_compatible` and gets SSRF-validated server-side, both at save
// time and at every polish call -- schema-level `.url()` below is a shape
// check only, NOT the security gate).
// =============================================================================

export const AiProviderSchema = z.enum(['anthropic', 'openai_compatible']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/**
 * `PUT /api/ai/key` body. `apiKey` bounds: a real provider key is
 * comfortably longer than 20 chars and nowhere near 200 -- these exist only
 * to reject an obviously-wrong paste (an empty string, a whole pasted
 * paragraph) before it ever reaches the provider, not to validate the key's
 * actual shape (the provider's own API is what validates that -- see
 * `lib/server/ai-polish.ts`'s `validateAnthropicKey`/
 * `validateOpenAiCompatibleKey`). `baseUrl`/`model` are REQUIRED for
 * `openai_compatible` (there is no sane built-in default the way
 * `anthropic` has a fixed base + a documented default model) and optional
 * for `anthropic` (an override of the default model; the base is never
 * user-supplied at all, see `lib/server/ai-polish.ts`'s `ANTHROPIC_BASE_URL`
 * constant). `.max(500)`/`.max(200)` mirror the CHECK constraints in
 * `supabase/migrations/20260724000012_ai_keys_providers.sql`. `baseUrl`'s
 * `.startsWith('https://')` (post-review SEC nit): `.url()` alone accepts
 * ANY scheme (`http://`, `ftp://`, ...) -- harmless on its own since
 * `lib/server/ssrf.ts`'s `assertSafeOutboundUrl` is the real, unconditional
 * gate (scheme included) and would reject a non-`https://` value regardless
 * -- but rejecting it HERE, at the schema layer, means a bad scheme fails
 * fast with a plain 400 before any validation network call is even
 * attempted, rather than surfacing as a less obvious `openai_bad_endpoint`
 * from deeper in the stack.
 */
export const SetAiKeyInputSchema = z
  .object({
    apiKey: z.string().min(20).max(200),
    provider: AiProviderSchema,
    baseUrl: z.string().min(1).max(500).url().startsWith('https://', { message: 'baseUrl must start with https://' }).optional(),
    model: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.provider !== 'openai_compatible' || (v.baseUrl !== undefined && v.model !== undefined), {
    message: 'baseUrl and model are required for an OpenAI-compatible provider.',
    path: ['baseUrl'],
  });
export type SetAiKeyInput = z.infer<typeof SetAiKeyInputSchema>;

/** `GET`/`PUT` `/api/ai/key` response. Never ciphertext, never plaintext -- see CLAUDE.md's "Data plane (Phase 7b)"-adjacent Phase 7c security section. `provider`/`baseUrl`/`model` are non-secret (see the column grant in `supabase/migrations/20260724000012_ai_keys_providers.sql`). */
export interface AiKeyStatusResponse {
  configured: boolean;
  hint: string;
  validatedAt: string | null;
  lastUsedAt: string | null;
  provider: AiProvider;
  baseUrl: string | null;
  model: string | null;
}
