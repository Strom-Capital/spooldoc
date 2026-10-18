'use client';

import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';

/** The sidebar and the page. */
export function AppShell({ children, sidebarOpen }: { children: ReactNode; sidebarOpen: boolean }) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-10 shrink-0 items-center gap-1 px-2 md:hidden">
          <SidebarTrigger />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
