// Phase 7a: session-refresh + route-protection middleware, per the current
// (non-deprecated) @supabase/ssr `getAll`/`setAll` cookie-adapter API -- the
// older `get`/`set`/`remove` examples still circulating are deprecated and
// break session refresh.
//
// Gated on `isSupabaseConfigured()`: in demo mode (no NEXT_PUBLIC_SUPABASE_URL)
// this middleware is a pure pass-through -- no auth, no redirects, Phase 1-6
// flows unchanged.
//
// Route protection: any request that isn't already authenticated is
// redirected to `/login?next=<pathname>`, EXCEPT:
//   - `/login` itself and everything under `/auth/*` (the confirm callback)
//   - `/reports/[id]/present` and `/daily/[id]/present` -- these are the
//     bare, outside-`(shell)` share/print routes (see CLAUDE.md "Routing").
//     Per Decision 1 (per-report share tokens, not "require sign-in"), these
//     must stay reachable by a recipient who was never asked to sign in.
//     Phase 7b wires the actual `?t=<token>`-aware present route; this
//     middleware only needs to make sure the auth *redirect* never fires for
//     this path shape, token or not -- so today's un-tokened present routes
//     (still world-readable via localStorage, same as Phase 2-6) keep
//     working, and 7b's tokened version will too, unchanged, the moment it
//     lands.
//
// Post-review fix (S10): `createServerClient` is imported dynamically,
// AFTER the `isSupabaseConfigured()` check below, not as a top-level
// `import`. A top-level import unconditionally bundles @supabase/ssr into
// the Edge middleware runtime for EVERY request, including demo mode
// (which never calls it) -- verified: middleware bundle size dropped from
// 91.5 kB to 63.3 kB in a demo-mode build once this was gated. A one-off,
// non-reproducible total outage was also observed in demo mode (every
// route 500ing with `EvalError: Code generation from strings disallowed
// for this context` at module-load time, before `isSupabaseConfigured()`
// ever ran) -- not confirmed reproducible in several subsequent clean
// builds, but deferring the import until it's actually needed removes the
// structural exposure regardless of root cause.
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from './lib/supabase/config';

// `/sw.js` must stay reachable while signed out. It is the self-destroying
// service worker (see public/sw.js) whose whole job is to evict a foreign
// worker left on this origin by another project; a foreign worker polls that
// exact path for updates, and if the poll gets a 307 to /login it receives
// HTML instead of JavaScript, rejects the update, and survives -- continuing
// to serve this app stale chunks. Belt-and-braces alongside the matcher's
// static-extension exclusion below.
const PUBLIC_EXACT_OR_PREFIX = [/^\/login$/, /^\/auth\//, /^\/sw\.js$/];
const PUBLIC_PRESENT = [/^\/reports\/[^/]+\/present$/, /^\/daily\/[^/]+\/present$/];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT_OR_PREFIX.some((re) => re.test(pathname)) || PUBLIC_PRESENT.some((re) => re.test(pathname));
}

export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  const { createServerClient } = await import('@supabase/ssr');

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not remove: this refreshes the session, and its return value
  // (`user`) is what route protection below relies on. Do not add logic
  // between `createServerClient` and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

// The extension list must cover every static asset type served from `public/`,
// not just images. It previously stopped at image formats, so `/sw.js` -- and
// any other script, stylesheet, font, or manifest in `public/` -- was run
// through auth and 307'd to /login while signed out. A static file answering
// with a login page is never right, and for `/sw.js` specifically it defeats
// the service-worker eviction described above. No application route ends in
// one of these extensions, so excluding them cannot shadow a real page.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|mjs|css|map|txt|json|webmanifest|woff|woff2|ttf|otf)$).*)',
  ],
};
