// Phase 7a: server-side Supabase client (Server Components, Route Handlers,
// Server Actions). Uses Next 15's ASYNC `cookies()` (must be awaited -- a
// common source of drift in older @supabase/ssr examples that still show
// `get`/`set`/`remove`; the current, non-deprecated adapter API is
// `getAll`/`setAll`, used below). `middleware.ts` is the one place that
// still needs the request/response-bound cookie adapter (see that file) --
// this one is for everything else (`app/auth/confirm/route.ts` today;
// Phase 7b's route handlers next).
//
// `setAll` is wrapped in a try/catch per the @supabase/ssr docs' own
// guidance: a Server Component can't set cookies (Next throws), and that's
// fine as long as middleware is refreshing the session -- swallowing the
// error here (rather than letting it bubble as an unhandled render error)
// is the documented, intended behavior, not an oversight.

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function createServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'createServerSupabase() called without NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY set -- callers must check isSupabaseConfigured() first.'
    );
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component that can't set cookies -- fine as
          // long as middleware.ts is refreshing the session on every request.
        }
      },
    },
  });
}
