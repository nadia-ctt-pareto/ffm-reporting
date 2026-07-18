import { Suspense } from 'react';
import { LoginScreen } from '@/components/auth/LoginScreen';

/**
 * `/login` -- deliberately lives OUTSIDE the `(shell)` route group (compare
 * `app/reports/[id]/present/page.tsx`) so only the root layout (fonts,
 * ThemeProvider) applies -- no sidebar. `middleware.ts` exempts this path
 * from the auth redirect (it would otherwise redirect-loop to itself).
 *
 * `<Suspense>` is required: LoginScreen reads `useSearchParams()` (for
 * `?next=`/`?error=`), and Next.js requires that hook's nearest client
 * component to sit under a Suspense boundary, or `next build` fails
 * prerendering this route (same requirement documented on the present route).
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
