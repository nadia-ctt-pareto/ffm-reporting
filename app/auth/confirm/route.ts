import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { POST_LOGIN_NEXT_COOKIE, safeNext } from '@/lib/safe-next';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * `/auth/confirm` -- the magic-link callback `signInWithOtp`'s
 * `emailRedirectTo` points at (see components/auth/LoginScreen.tsx). GET
 * because this is what the user's mail client follows as a plain link.
 * `verifyOtp({ type, token_hash })` exchanges the emailed token for a real
 * session (setting cookies via lib/supabase/server.ts's `setAll`), then
 * redirects to the sanitized post-login destination -- read from the
 * `POST_LOGIN_NEXT_COOKIE` cookie LoginScreen.tsx set in this same browser
 * before sending the email (see lib/safe-next.ts's doc comment for why
 * `next` rides along in a cookie rather than in the emailed link itself),
 * defaulting to `/` if the cookie is absent/unsafe -- or
 * `/login?error=invalid_link` on any verification failure
 * (missing/expired/already-used token). `middleware.ts` exempts `/auth/*`
 * from the auth redirect, so this route is reachable while signed out.
 */
function decodeCookieValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = (url.searchParams.get('type') as EmailOtpType | null) ?? 'email';
  const next = safeNext(decodeCookieValue(request.cookies.get(POST_LOGIN_NEXT_COOKIE)?.value));

  if (tokenHash) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const response = NextResponse.redirect(new URL(next, url.origin));
      response.cookies.delete(POST_LOGIN_NEXT_COOKIE);
      return response;
    }
  }

  return NextResponse.redirect(new URL('/login?error=invalid_link', url.origin));
}
