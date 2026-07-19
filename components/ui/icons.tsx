// Phase 5 (Sidebar): hand-authored inline SVG nav icons, deliberately NOT
// lucide-react -- lucide is stroke-based with round caps/joins, which fights
// this design system's "square corners everywhere" rule. Every icon here
// shares a 16x16 viewBox, reads `currentColor` (so the active-nav chip's
// text-heading/surface-page inversion "just works" with zero extra CSS),
// and uses `strokeLinecap="square"`/`strokeLinejoin="miter"` wherever a
// stroke is used, to stay on-brand.

import type { SVGProps } from 'react';

function IconBase({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 2x2 grid of squares -- the square aesthetic's natural "dashboard" glyph. */
export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" />
      <rect x="9" y="1.5" width="5.5" height="5.5" />
      <rect x="1.5" y="9" width="5.5" height="5.5" />
      <rect x="9" y="9" width="5.5" height="5.5" />
    </IconBase>
  );
}

/** A page/sheet with a folded corner and two text lines -- "daily report". */
export function IconDaily(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 1.5H9.5L13 5V14.5H3Z" />
      <path d="M9.5 1.5V5H13" />
      <path d="M5.5 8.5H10.5" />
      <path d="M5.5 11H10.5" />
    </IconBase>
  );
}

/** A square checkbox with a check -- "tasks". */
export function IconTasks(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="1.5" y="1.5" width="13" height="13" />
      <path d="M4.5 8.2L7 10.7L11.5 5.7" />
    </IconBase>
  );
}

/** A square calendar frame with a header bar and two day-dots -- "calendar". */
export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="1.5" y="2.5" width="13" height="12" />
      <path d="M1.5 6H14.5" />
      <path d="M4.5 1V4" />
      <path d="M11.5 1V4" />
      <rect x="4" y="8.2" width="1.6" height="1.6" fill="currentColor" stroke="none" />
      <rect x="9" y="8.2" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** Two outlined squares (top-left, top-right) converging into one solid square (bottom-center) -- "consolidate": merging several into one. */
export function IconConsolidate(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="1.2" y="1.2" width="6" height="6" />
      <rect x="8.8" y="1.2" width="6" height="6" />
      <rect x="5" y="8.8" width="6" height="6" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** Three horizontal sliders with square knobs -- a gear is inherently round, so sliders read as "settings" while staying on-brand. */
export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M1.5 3.5H14.5" />
      <rect x="6" y="1.8" width="1.8" height="3.4" fill="currentColor" stroke="none" />
      <path d="M1.5 8H14.5" />
      <rect x="9.5" y="6.3" width="1.8" height="3.4" fill="currentColor" stroke="none" />
      <path d="M1.5 12.5H14.5" />
      <rect x="3.5" y="10.8" width="1.8" height="3.4" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** Phase 7a: an open square door frame + an arrow exiting through it -- "sign out". Same square-cornered aesthetic as every other sidebar icon (was a bare "⎋" glyph, the only non-SVG sidebar icon; see Sidebar.tsx). */
export function IconSignOut(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M7 1.5H2.5V14.5H7" />
      <path d="M6 8H14.5" />
      <path d="M11 4.5L14.5 8L11 11.5" />
    </IconBase>
  );
}

/** Mobile P2: three horizontal bars -- "menu", opens the off-canvas nav drawer (components/app/MobileNav.tsx) from the mobile top bar. */
export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M1.5 4H14.5" />
      <path d="M1.5 8H14.5" />
      <path d="M1.5 12H14.5" />
    </IconBase>
  );
}
