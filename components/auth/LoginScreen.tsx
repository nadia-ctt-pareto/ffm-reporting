'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { POST_LOGIN_NEXT_COOKIE, safeNext } from '@/lib/safe-next';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import styles from './LoginScreen.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link: 'That sign-in link is invalid or has expired. Request a new one below.',
};

/**
 * `/login` -- deliberately OUTSIDE the `(shell)` route group (no sidebar;
 * only the root layout's fonts/ThemeProvider apply), same idiom as
 * `/reports/[id]/present`'s "Report Not Found" state
 * (components/report/PresentScreen.module.css). Magic-link only: email in,
 * `auth.signInWithOtp`, "Check your email" out -- no password field. Reads
 * `?next=`/`?error=` via `useSearchParams()`; the caller (app/login/page.tsx)
 * wraps this in `<Suspense>`, the same Next.js requirement documented on
 * PresentScreen.
 */
export function LoginScreen() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(urlError ? (ERROR_MESSAGES[urlError] ?? 'Something went wrong signing in.') : null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatus('sending');
    try {
      const supabase = getSupabaseBrowserClient();
      // `next` rides along in a short-lived cookie (see lib/safe-next.ts's
      // POST_LOGIN_NEXT_COOKIE doc comment for the full rationale), NOT in
      // `emailRedirectTo`'s query string -- `emailRedirectTo` is
      // deliberately just the bare, query-string-free `/auth/confirm`, an
      // always-exact match against supabase/config.toml's
      // `additional_redirect_urls` with zero ambiguity.
      document.cookie = `${POST_LOGIN_NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; SameSite=Lax`;
      const redirectTo = `${window.location.origin}/auth/confirm`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        setErrorMessage(error.message);
        setStatus('idle');
        return;
      }
      setStatus('sent');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong sending the sign-in link.');
      setStatus('idle');
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.mark}>Foundation First Marketing</div>
      <h1 className={styles.title}>Weekly Reports</h1>
      <p className={styles.copy}>Sign in with your Foundation First or Arcytex email address to continue.</p>

      <div className={styles.card}>
        {status === 'sent' ? (
          <div role="status" aria-live="polite">
            <p className={styles.sentMark}>Check your email</p>
            <p className={styles.sentCopy}>
              We sent a sign-in link to <strong>{email}</strong>. Open it on this device to continue.
            </p>
          </div>
        ) : (
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
            <Button type="submit" variant="primary" disabled={status === 'sending' || !email}>
              {status === 'sending' ? 'Sending link…' : 'Send Magic Link'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
