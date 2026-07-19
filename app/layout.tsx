import type { Metadata } from 'next';
import { Open_Sans, Poppins } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
});

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-open-sans',
});

export const metadata: Metadata = {
  title: 'Weekly Reports — Foundation First Marketing',
};

// Sets `data-theme="dark"` on <html> before hydration so a stored dark-mode
// preference -- OR a system-dark preference (explicit 'system', or no
// stored preference at all, which defaults to 'system', see
// ThemeProvider.tsx) -- never flashes light on first paint. The `!t` branch
// is what makes a first-visit system-dark user get dark pre-hydration,
// matching ThemeProvider's own 'system' default; keep these two defaults
// consistent if either ever changes. See components/theme/ThemeProvider.tsx
// for the client-side half of this.
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('ff.theme');if(t==='dark'||((t==='system'||!t)&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}`;

// Evicts any service worker registered against this ORIGIN by a different
// project. Service-worker scope is per-origin, not per-app, so another dev
// server previously run on the same localhost port can leave a cache-first
// Workbox worker behind that then serves THIS app stale JS chunks -- which
// surfaces as `Cannot read properties of undefined (reading 'call')` and
// survives every `rm -rf .next`, because the stale bytes live in the browser's
// Cache Storage, not on disk. See public/sw.js for the full explanation.
//
// public/sw.js handles the common case (a foreign worker registered at
// `/sw.js`, which polls that path for updates). This script covers the rest:
// a worker registered at any OTHER path can only be reached through the
// registration API. It no-ops when nothing is registered -- which is every
// normal load -- and the sessionStorage flag makes the reload strictly
// one-shot, so it can never loop.
const SW_PURGE_SCRIPT = `try{if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){if(!rs.length)return;Promise.all(rs.map(function(r){return r.unregister()})).then(function(){return window.caches?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}):null}).then(function(){if(!sessionStorage.getItem('ff.sw-purged')){sessionStorage.setItem('ff.sw-purged','1');location.reload()}})})}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${openSans.variable}`} suppressHydrationWarning>
      <body>
        <Script id="ff-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Script id="ff-sw-purge" strategy="beforeInteractive">
          {SW_PURGE_SCRIPT}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
