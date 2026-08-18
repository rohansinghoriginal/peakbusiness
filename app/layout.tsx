import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import Script from 'next/script'

import { appConfig } from '@/lib/app-config'
import { ThemeProvider } from '@/lib/theme-context'

import './globals.css'

export const metadata: Metadata = {
  title: `${appConfig.appName} · Operations`,
  description: appConfig.appDescription,
}

// Blocking script to prevent flash of wrong theme on load
// Runs before any React hydration, sets data-theme on <html> immediately
function ThemeInitScript() {
  return (
    <Script
      id="theme-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var stored = localStorage.getItem('peak-theme');
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              var theme = stored === 'dark' || (!stored && prefersDark) ? 'dark' : 'light';
              document.documentElement.dataset.theme = theme;
            } catch (e) {
              document.documentElement.dataset.theme = 'light';
            }
          })();
        `,
      }}
    />
  )
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body>
        <div className="bga-03" aria-hidden="true">
          <div className="bga-03__field" />
          <div className="bga-03__wave" />
          <div className="bga-03__glow" />
        </div>
        <ThemeProvider>
          <ClerkProvider>{children}</ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
