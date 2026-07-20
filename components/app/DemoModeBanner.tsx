'use client';

import { useEffect, useState } from 'react';
import { isLocalDevOrigin } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from './DemoModeBanner.module.css';

/**
 * Post-review hardening (SHOULD-FIX 10): the runtime-visible half of the
 * misconfigured-production fix (see next.config.ts's build-time half). The
 * repository factory (lib/data/index.ts) has always silently fallen back to
 * `LocalStorageReportsRepository` whenever the Supabase env vars are unset
 * -- REQUIRED for the local demo-mode workflow, but the stated mitigation
 * for a real misconfigured deploy was a one-time `console.warn`, visible
 * only to someone with devtools open. Not adequate for "the entire auth
 * boundary vanished and every visitor is now authoring reports into their
 * own browser's localStorage believing they persisted."
 *
 * Renders nothing (not even a layout-shifting empty node) unless BOTH:
 *   - `!isSupabaseConfigured()` -- demo mode is actually active, and
 *   - `!isLocalDevOrigin()` -- this is NOT the supported local/dev workflow
 *     (localhost/127.0.0.1/*.local always render nothing here, exactly
 *     mirroring the factory's own `console.warn` gate, lib/data/index.ts).
 *
 * Computed in a `useEffect`, not inline during render: `isLocalDevOrigin()`
 * reads `window.location.hostname`, which doesn't exist during SSR --
 * computing it inline would either crash on the server or (worse) silently
 * diverge between the server-rendered HTML (no `window`, always "local") and
 * the client's first paint on a real non-local origin, a hydration
 * mismatch. Starting from `false` (render nothing) and flipping to `true`
 * post-mount, same hydration-safety pattern as `ThemeProvider`/`AppShell`'s
 * own `collapsed` state, means the server and the FIRST client render always
 * agree; the banner can only ever appear one tick later, never mismatch.
 */
export function DemoModeBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(!isSupabaseConfigured() && !isLocalDevOrigin());
  }, []);

  if (!show) return null;

  return (
    <div className={styles.banner} role="status">
      Demo mode — data is stored only in this browser (no account, no cross-device sync). Contact an admin if you expected
      to be signed in.
    </div>
  );
}
