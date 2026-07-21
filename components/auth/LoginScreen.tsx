'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { safeNext } from '@/lib/safe-next';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import styles from './LoginScreen.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link: 'That sign-in link is invalid or has expired. Request a new one below.',
};

/**
 * Maps a raw `signInWithPassword` error message to user-facing copy.
 * GoTrue's own error strings are written for developers, not end users
 * (e.g. "Invalid login credentials" deliberately doesn't distinguish "no
 * such email" from "wrong password", to avoid leaking which emails have
 * accounts) -- never surface `error.message` verbatim; only this small
 * allow-list of mapped, user-actionable copy plus a generic fallback for
 * anything unmapped.
 */
function mapSignInError(message: string): string {
  if (message === 'Invalid login credentials') return 'Incorrect email or password.';
  if (message === 'Email not confirmed') return "Your account isn't confirmed yet — ask your admin to confirm it.";
  return "Couldn't sign you in. Try again.";
}

/**
 * `/login` -- deliberately OUTSIDE the `(shell)` route group (no sidebar;
 * only the root layout's fonts/ThemeProvider apply), same idiom as
 * `/reports/[id]/present`'s "Report Not Found" state
 * (components/report/PresentScreen.module.css).
 *
 * Email + password sign-in only, via `auth.signInWithPassword` --
 * superseding magic-link-only sign-in, which was unreliable for daily
 * internal use (rate-limited email, friction every login). Accounts are
 * admin-created (and admin-confirmed), so there is deliberately NO
 * self-signup UI here. The `signInWithOtp`/`/auth/confirm` magic-link
 * infrastructure is left in place, unused, so it can be re-enabled later if
 * SMTP is added -- see app/auth/confirm/route.ts.
 *
 * No `POST_LOGIN_NEXT_COOKIE` write here (unlike the old magic-link flow):
 * that cookie existed purely to carry `next` across the email round-trip
 * (set before `signInWithOtp`, read back by `/auth/confirm` after the user
 * clicks the emailed link, possibly in a different tab/session). Password
 * sign-in has no such round-trip -- `next` is already in this page's own
 * URL and is used directly below. `lib/safe-next.ts`'s cookie constant and
 * `/auth/confirm`'s read of it are untouched, so magic link keeps working
 * unmodified if re-enabled.
 *
 * Reads `?next=`/`?error=` via `useSearchParams()`; the caller
 * (app/login/page.tsx) wraps this in `<Suspense>`, the same Next.js
 * requirement documented on PresentScreen.
 */
export function LoginScreen() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(
    urlError ? (ERROR_MESSAGES[urlError] ?? 'Something went wrong signing in.') : null
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatus('submitting');
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMessage(mapSignInError(error.message));
        setStatus('idle');
        return;
      }
      // Full navigation, NOT router.push: signInWithPassword just set the
      // session cookies client-side, and middleware.ts's auth check runs
      // server-side on the next request -- a client-side route transition
      // would carry the old (signed-out) SSR state with it, bouncing this
      // navigation right back to /login. window.location.assign forces a
      // real request so middleware sees the fresh cookies immediately.
      window.location.assign(next);
    } catch {
      // A thrown exception here (network failure, etc.) never carries one
      // of the two mapped GoTrue messages -- go straight to the generic
      // fallback rather than routing an arbitrary caught error through
      // mapSignInError.
      setErrorMessage("Couldn't sign you in. Try again.");
      setStatus('idle');
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.mark}>Foundation First Marketing</div>
      <h1 className={styles.title}>Weekly Reports</h1>
      <p className={styles.copy}>Sign in to continue.</p>

      <div className={styles.card}>
        <form className={styles.form} onSubmit={handleSubmit}>
          {errorMessage ? (
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <Input
            type="email"
            label="Email address"
            placeholder="you@foundationfirst.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            required
          />
          <Input
            type="password"
            label="Password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Button type="submit" variant="primary" disabled={status === 'submitting' || !email || !password}>
            {status === 'submitting' ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
