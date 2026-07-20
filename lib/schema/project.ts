// Phase 6a: the Project entity. Matches the SQL `projects` table exactly
// (supabase/migrations/20260718000003_projects.sql, renamed from `clients`)
// -- no `createdAt`, deliberately minimal. Ids are the slugs already seeded
// in supabase/migrations/20260717000001_initial_schema.sql
// ('helitech-foundation-waterproofing', ...) -- see lib/seed.ts's
// seedProjects().

import { z } from 'zod';

// Post-review hardening (SHOULD-FIX 8, same rationale as lib/schema/report.ts's
// MAX_ID_LEN/MAX_SHORT_TEXT constants -- `.max()` doesn't change the inferred
// TS type, so no migration/docs delta is needed).
export const ProjectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
});
