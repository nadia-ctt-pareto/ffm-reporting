'use client';

// Phase 7c (BYOK AI field polish): a minimal, module-cached "is polish
// available for me right now" check -- the one consumer of `GET /api/ai/key`
// OUTSIDE Settings. RECONCILIATION DELTA: `components/settings/AiKeySection.tsx`
// does NOT use this hook -- it's modeled on `McpAccessSection.tsx`'s
// self-contained fetch/CRUD state instead (see that component's header
// comment). This hook exists purely so `components/ai/PolishButton.tsx`
// (rendered many times over a single wizard page -- one per polishable
// field) issues ONE `GET /api/ai/key` per page session, not one per button.
//
// Deliberately much smaller than `AiKeySection`'s own state: this only ever
// needs the boolean "should a Polish button render at all", never the
// hint/timestamps `AiKeySection` displays.

import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../supabase/config';

export type AiKeyStatusState = 'unknown' | 'unconfigured' | 'configured';

let cachedState: AiKeyStatusState | null = null;
let inFlight: Promise<AiKeyStatusState> | null = null;

async function fetchStatus(): Promise<AiKeyStatusState> {
  if (!isSupabaseConfigured()) return 'unconfigured';
  try {
    const res = await fetch('/api/ai/key', { credentials: 'same-origin' });
    // 404 -- isAiPolishConfigured() is false server-side (no Supabase, or no
    // AI_BYOK_ENCRYPTION_KEY). 401 -- signed out (shouldn't happen inside
    // the (shell) route group, but fails closed regardless). Anything not
    // `ok` is treated as "no polish available" rather than surfaced as an
    // error -- this hook has no error channel by design (see doc comment
    // above), only a button-visibility signal.
    if (!res.ok) return 'unconfigured';
    const body = (await res.json()) as { configured?: boolean };
    return body.configured ? 'configured' : 'unconfigured';
  } catch {
    return 'unconfigured';
  }
}

/**
 * Post-review-hardening-precedent invalidation hook: `AiKeySection` calls
 * this after a successful save/remove so a `PolishButton` that mounts
 * LATER in the SAME browser tab (e.g. navigating from `/settings` to a
 * wizard page, in the same tab, after saving a key) picks up the new state
 * without a full reload. `cachedState`/`inFlight` are plain module-scope
 * variables, scoped to ONE JS module instance -- they do NOT reach across
 * browser tabs/windows (each has its own separate module instantiation,
 * so a wizard genuinely left open in ANOTHER tab keeps its own stale cache
 * until it re-fetches on its own, e.g. a future navigation/remount there).
 * Safe to call even if nothing has ever fetched yet (`cachedState`/
 * `inFlight` are simply reset to their initial state).
 */
export function invalidateAiKeyStatusCache(): void {
  cachedState = null;
  inFlight = null;
}

export function useAiKeyStatus(): AiKeyStatusState {
  const [state, setState] = useState<AiKeyStatusState>(cachedState ?? 'unknown');

  useEffect(() => {
    if (cachedState) {
      setState(cachedState);
      return;
    }
    if (!inFlight) {
      inFlight = fetchStatus().then((resolved) => {
        cachedState = resolved;
        inFlight = null;
        return resolved;
      });
    }
    let cancelled = false;
    inFlight.then((resolved) => {
      if (!cancelled) setState(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
