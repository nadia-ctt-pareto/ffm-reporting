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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${openSans.variable}`} suppressHydrationWarning>
      <body>
        <Script id="ff-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
