'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** The resolved theme actually applied to `data-theme`. */
export type Theme = 'light' | 'dark';

/** What the user picked -- 'system' resolves to `Theme` via `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ff.theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  /** The user's stored choice -- 'light' | 'dark' | 'system'. */
  preference: ThemePreference;
  /** The resolved theme actually applied to `<html data-theme>` (never 'system'). */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

/**
 * Cross-route dark-mode source of truth (replaces the old per-component
 * `darkMode` useState in WeeklyReportsApp). Persists to
 * localStorage['ff.theme'] and mirrors the RESOLVED theme onto
 * `<html data-theme>`.
 *
 * Phase 5: gained a 'system' preference. State is the *preference*, not the
 * resolved theme; `theme` in the context value is always the resolved
 * 'light'/'dark' value every consumer actually renders against. While
 * `preference === 'system'`, a `change` listener on the
 * `prefers-color-scheme` media query keeps `theme` live without a reload.
 *
 * The initial render always assumes 'light' (matching the server) so no
 * theme-dependent control (e.g. the Settings screen's theme picker) hydrates
 * with mismatched state; a one-time effect syncs from localStorage right
 * after mount. The pre-hydration flash of the *page itself* is prevented
 * separately by the inline script in app/layout.tsx, which sets
 * `data-theme` on `<html>` before hydration ever runs -- its own default
 * (system-dark -> dark) must stay consistent with this provider's default
 * (see THEME_INIT_SCRIPT's comment).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [theme, setThemeState] = useState<Theme>('light');
  // Guards the sync effect below from running on the first commit, where
  // `theme` is still the server-default 'light'. Without it, a stored-dark
  // user's first passive-effect flush would clear the `data-theme` attribute
  // the pre-hydration script just set (a latent FOUC) before the localStorage
  // read re-applies it. Same pattern AppShell uses for its collapse state.
  const [hydrated, setHydrated] = useState(false);

  // One-time sync from localStorage after mount (client only) -- see the
  // hydration-mismatch note above for why this can't happen in useState's
  // lazy initializer. Legacy stored 'light'/'dark' values remain valid
  // preferences; an absent key defaults to 'system' (matching the initial
  // state above and THEME_INIT_SCRIPT's `!t` branch). Resolves `theme`
  // SYNCHRONOUSLY off the freshly-read `nextPreference` right here (not via
  // a separate effect keyed on `preference`) -- see the resolve effect
  // below for why that separation is exactly what caused a real,
  // briefly-visible FOUC bug during development (a stale-closure race
  // between two mount-time effects).
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (e.g. private browsing) -- stay on default.
    }
    const nextPreference: ThemePreference = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
    setPreferenceState(nextPreference);
    setThemeState(resolveTheme(nextPreference));
    setHydrated(true);
  }, []);

  // Resolves `theme` from `preference` for every change AFTER the initial
  // hydration sync above -- explicit Light/Dark picks resolve immediately;
  // 'system' additionally attaches a `change` listener on the media query
  // (torn down/re-attached as `preference` changes) so a live OS theme
  // flip updates the app without a reload.
  //
  // Gated on `hydrated` -- NOT just `[preference]` -- on purpose: on the
  // very first commit, `preference` is still its initial 'system' default
  // (the mount-sync effect above hasn't applied its `setPreferenceState`
  // yet -- effects within the same commit all read the SAME pre-update
  // render's state). An earlier version of this effect ran unconditionally
  // on mount using that stale 'system' closure, independently resolving
  // `theme` off the CURRENT (possibly non-matching) OS preference and
  // racing with the mount-sync effect's own theme resolution above --
  // whichever effect's queued `setThemeState` call landed last inside that
  // commit won, which was a coin flip that could clobber a legacy
  // `localStorage['ff.theme'] === 'dark'` user's correctly-resolved 'dark'
  // theme with 'light' for one render, actively REMOVING the `data-theme`
  // attribute the pre-hydration script had just set -- a real, briefly-
  // visible FOUC (verified with a Playwright DOM snapshot immediately after
  // `domcontentloaded`). Gating on `hydrated` defers this effect's first
  // real run until the render AFTER the mount-sync effect's `preference`
  // update has already landed, so it only ever reads the CORRECT resolved
  // preference -- never the stale pre-hydration default.
  useEffect(() => {
    if (!hydrated) return;
    if (preference !== 'system') {
      setThemeState(preference);
      return;
    }
    if (typeof window.matchMedia !== 'function') {
      setThemeState('light');
      return;
    }
    const mql = window.matchMedia(MEDIA_QUERY);
    const apply = () => setThemeState(mql.matches ? 'dark' : 'light');
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [preference, hydrated]);

  useEffect(() => {
    if (!hydrated) return; // don't clobber the pre-hydration script's attribute
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore
    }
  }, [preference, hydrated]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
  }, []);

  return <ThemeContext.Provider value={{ preference, theme, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
