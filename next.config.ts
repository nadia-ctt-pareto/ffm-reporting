import type { NextConfig } from "next";

// Post-review hardening (SHOULD-FIX 10): the repository factory
// (lib/data/index.ts) silently falls back to per-browser localStorage
// (no auth, no server-side data) whenever
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are unset -- the
// REQUIRED behavior for local demo mode (`npm run dev` with no `.env.local`),
// but a genuine misconfiguration if it happens on a real Vercel Production
// deploy: the entire auth boundary vanishes with nothing louder than a
// console warning (see that file's `warnedFallback` logic, which is itself
// only the RUNTIME half of this fix -- see components/app/DemoModeBanner.tsx
// for the other, in-app half). Failing the BUILD outright for this one
// specific case is the loudest, earliest place to catch it -- a broken
// Production deploy never even goes live.
//
// Scoped deliberately narrow: `process.env.VERCEL_ENV === 'production'` is
// set by Vercel's own platform (not something this repo or its CI sets) --
// undefined everywhere else (local `next build`/`next start`, Vercel Preview
// deploys, any non-Vercel host), so this is a no-op for every supported demo-
// mode workflow, including this repo's own `npm run build` gate.
if (process.env.VERCEL_ENV === "production" && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
  throw new Error(
    "Refusing to build for Vercel Production: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are not both set. " +
      "A Production deploy missing these silently degrades into an unauthenticated, per-browser localStorage app (see " +
      "lib/data/index.ts's getReportsRepository()) -- set both in the Vercel dashboard's Production environment before " +
      "deploying, or set this build's environment to something other than \"production\" if it's intentionally a demo."
  );
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
