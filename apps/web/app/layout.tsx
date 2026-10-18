import type { Metadata } from 'next';
import { Geist, Geist_Mono, Montserrat } from 'next/font/google';
import { cookies } from 'next/headers';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/components/session-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const montserrat = Montserrat({ subsets: ['latin'], weight: ['600'], variable: '--font-montserrat' });

export const metadata: Metadata = {
  title: 'Spooldoc',
  description: 'Turn IBM i spooled files into JSON documents and render them with templates.',
  icons: {
    icon: [
      { url: '/brand/spooldoc-favicon-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
      { url: '/brand/spooldoc-favicon-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
    ],
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The sidebar starts as an icon rail until the user expands it (the sidebar keeps the choice in this cookie).
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value === 'true';
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <SessionProvider>
              <AppShell sidebarOpen={sidebarOpen}>{children}</AppShell>
            </SessionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
