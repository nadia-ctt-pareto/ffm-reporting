import { Button } from '@/components/ui/Button';
import styles from './AuthorizeScreen.module.css';

export type AuthorizeScreenProps =
  | { status: 'error'; title: string; message: string }
  | {
      status: 'consent';
      clientName: string;
      userEmail: string;
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      state: string;
    };

/**
 * `/oauth/authorize`'s presentation -- same bare, centered-card idiom as
 * `components/auth/LoginScreen.module.css` (no sidebar; outside the
 * `(shell)` route group -- see `app/oauth/authorize/page.tsx`, which does
 * all the data-fetching/validation and passes the result here as plain
 * props). No `'use client'` -- this is a pure, static server-rendered
 * form; the Approve/Deny buttons are plain HTML `<button type="submit">`s
 * inside a real `<form method="POST" action="/oauth/authorize/decision">`
 * -- no client JS at all. A `page.tsx` and a `route.ts` cannot share one
 * path+method pair in the App Router, which is why the decision lives at a
 * SEPARATE path; that route re-validates every one of these hidden fields
 * server-side rather than trusting this round-trip -- see its own header
 * comment.
 */
/** The destination host a deceptive `client_name` can't spoof -- post-review
 * should-fix (anti-phishing): a malicious DCR registration could pick any
 * display name it likes, but `redirect_uri` was independently verified
 * (both at registration and again at authorize-time) against the
 * claude.ai/claude.com allowlist -- surfacing IT, not just the
 * self-reported name, gives the user a real counter-signal. Falls back to
 * the raw string if it somehow isn't a parseable URL (shouldn't happen --
 * both layers already validated it -- but this is a presentational
 * fallback, not a security boundary). */
function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return redirectUri;
  }
}

export function AuthorizeScreen(props: AuthorizeScreenProps) {
  if (props.status === 'error') {
    return (
      <div className={styles.wrap}>
        <div className={styles.mark}>Foundation First Marketing</div>
        <h1 className={styles.title}>{props.title}</h1>
        <p className={styles.copy}>{props.message}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.mark}>Foundation First Marketing</div>
      <h1 className={styles.title}>Authorize Access</h1>
      <p className={styles.copy}>
        <strong>{props.clientName}</strong> wants to access your Weekly Reports account ({props.userEmail}).
      </p>

      <div className={styles.card}>
        <p className={styles.destination}>
          Approving will send an access code to <strong>{redirectHost(props.redirectUri)}</strong>.
        </p>
        <ul className={styles.scopeList}>
          <li>Read every report (same as your dashboard).</li>
          <li>Create and edit reports it creates on your behalf.</li>
          <li>Never delete a report -- there is no delete capability.</li>
        </ul>

        <form method="POST" action="/oauth/authorize/decision" className={styles.form}>
          <input type="hidden" name="client_id" value={props.clientId} />
          <input type="hidden" name="redirect_uri" value={props.redirectUri} />
          <input type="hidden" name="code_challenge" value={props.codeChallenge} />
          <input type="hidden" name="state" value={props.state} />
          <div className={styles.buttonRow}>
            <Button type="submit" name="decision" value="deny" variant="outline">
              Deny
            </Button>
            <Button type="submit" name="decision" value="approve" variant="primary">
              Approve
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
