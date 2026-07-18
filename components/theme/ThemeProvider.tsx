'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ff.theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Cross-route dark-mode source of truth (replaces the old per-component
 * `darkMode` useState in WeeklyReportsApp). Persists to
 * localStorage['ff.theme'] and mirrors the value onto `<html data-theme>`.
 *
 * The initial render always assumes 'light' (matching the server) so no
 * theme-dependent control (e.g. the sidebar's Dark Mode switch) hydrates
 * with mismatched state; a one-time effect syncs from localStorage right
 * after mount. The pre-hydration flash of the *page itself* is prevented
 * separately by the inline script in app/layout.tsx, which sets
 * `data-theme` on `<html>` before hydration ever runs.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  // Guards the sync effect below from running on the first commit, where
  // `theme` is still the server-default 'light'. Without it, a stored-dark
  // user's first passive-effect flush would clear the `data-theme` attribute
  // the pre-hydration script just set (a latent FOUC) before the localStorage
  // read re-applies it. Same pattern AppShell uses for its collapse state.
  const [hydrated, setHydrated] = useState(false);

  // One-time sync from localStorage after mount (client only) -- see the
  // hydration-mismatch note above for why this can't happen in useState's
  // lazy initializer.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') setThemeState('dark');
    } catch {
      // localStorage unavailable (e.g. private browsing) -- stay on default.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // don't clobber the pre-hydration script's attribute
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme, hydrated]);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
