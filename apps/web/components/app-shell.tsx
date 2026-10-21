'use client';

import { MenuIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { Logo } from './logo';

/** The sidebar and the page. */
export function AppShell({ children, sidebarOpen }: { children: ReactNode; sidebarOpen: boolean }) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <MobileBar />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** On phones: the wordmark, and the menu button that opens the sidebar from the right. */
function MobileBar() {
  const { toggleSidebar } = useSidebar();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4 pr-2 md:hidden">
      <Link href="/" aria-label="Spooldoc home">
        <Logo className="h-6" />
      </Link>
      <Hint text="Open menu">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu">
          <MenuIcon />
        </Button>
      </Hint>
    </header>
  );
}
