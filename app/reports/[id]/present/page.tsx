import { Suspense } from 'react';
import { PresentScreen } from '@/components/report/PresentScreen';

/**
 * `/reports/[id]/present` -- deliberately lives OUTSIDE the `(shell)` route
 * group (compare `app/(shell)/reports/[id]/page.tsx`) so only the root
 * layout (app/layout.tsx: fonts, ThemeProvider) wraps it -- the sidebar
 * shell never applies here. This is a distinct resolved path from every
 * `(shell)` route, so there's no route-group collision.
 *
 * `<Suspense>` is required here: PresentScreen reads `useSearchParams()`
 * (for `?print=1`), and Next.js requires that hook's nearest client
 * component to sit under a Suspense boundary, or `next build` fails
 * prerendering this route.
 */
export default async function PresentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PresentScreen id={id} />
    </Suspense>
  );
}
