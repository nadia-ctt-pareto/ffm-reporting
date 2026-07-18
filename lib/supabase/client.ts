// Phase 7a: browser Supabase client singleton, used by client components
// (the /login page's signInWithOtp call, the sidebar's session footer /
// sign-out). Only ever called when isSupabaseConfigured() is true --
// callers are responsible for that check (see lib/supabase/config.ts); this
// file does not guard it itself so the error is loud (a thrown error, not a
// silently broken client) if that invariant is ever violated.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Typed explicitly as `SupabaseClient` (not `ReturnType<typeof
// createBrowserClient>`): `createBrowserClient` is a generic, overloaded
// function, and assigning its result into a module-scope `let` typed via
// `ReturnType<typeof ...>` makes TypeScript's control-flow narrowing give up
// and silently infer this function's return type as `any` (verified: a
// `--declaration` emit showed `getSupabaseBrowserClient(): any`, which is
// what let every `.then(({ data }) => ...)` call site go unchecked). An
// explicit `SupabaseClient` annotation on both the variable and the return
// type sidesteps the inference gap entirely.
let singleton: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!singleton) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        'getSupabaseBrowserClient() called without NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY set -- callers must check isSupabaseConfigured() first.'
      );
    }
    singleton = createBrowserClient(url, anonKey);
  }
  return singleton;
}
