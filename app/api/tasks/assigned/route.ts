// WP3 (the access flip): GET the CALLER's own assigned tasks for
// `/api/tasks/assigned`. Cloned from `app/api/team/route.ts`'s GET
// skeleton (demo-mode 404, defense-in-depth `auth.getUser()` check) -- see
// that file's header comment for the rationale, identical here. No body,
// no mutation guards needed (a plain GET).

import { NextResponse } from 'next/server';
import { listAssignedTasks } from '@/lib/server/reports-service';
import { handleServiceError } from '@/lib/server/route-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const tasks = await listAssignedTasks(supabase);
    return NextResponse.json({ tasks });
  } catch (err) {
    return handleServiceError(err, { route: 'api/tasks/assigned GET', userId: user.id });
  }
}
