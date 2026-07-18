// Phase 6a: the Project entity. Matches the SQL `projects` table exactly
// (supabase/migrations/20260718000003_projects.sql, renamed from `clients`)
// -- no `createdAt`, deliberately minimal. Ids are the slugs already seeded
// in supabase/migrations/20260717000001_initial_schema.sql
// ('helitech-foundation-waterproofing', ...) -- see lib/seed.ts's
// seedProjects().

import { z } from 'zod';

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
