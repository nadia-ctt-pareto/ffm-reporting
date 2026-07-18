'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import { isSupabaseConfigured } from '../supabase/config';

export interface UseSessionResult {
  /** null until the first check resolves, or permanently null in demo mode / signed-out. */
  user: User | null;
  /** true only until the first auth.getUser() check resolves. */
  loading: boolean;
}

/**
 * Phase 7a: feeds the sidebar's session footer (signed-in email + Sign Out,
 * rendered only when `isSupabaseConfigured()`). Mirrors `useReports()`'s
 * shape (a `null`-until-resolved value, avoiding a hydration mismatch) --
 * `onAuthStateChange` keeps `user` live across sign-in/out without a reload,
 * same pattern the login page and confirm route rely on implicitly via a
 * full navigation.
 */
export function useSession(): UseSessionResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setUser(data.user);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
