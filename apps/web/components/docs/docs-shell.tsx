'use client';

import { ArrowLeftIcon, MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import type { DocsGroup } from '@/lib/server/docs';
import { DocsSearch, DocsSearchButton } from './docs-search';

/** The docs: the guides in their groups on the left, search, and the page. */
export function DocsShell({ nav, children }: { nav: DocsGroup[]; children: ReactNode }) {
  return (
    <DocsSearch>
      {/* Always open on desktop; on phones the sidebar opens from the menu button. */}
      <SidebarProvider open onOpenChange={() => undefined}>
        <DocsSidebar nav={nav} />
        <SidebarInset className="min-w-0">
          <MobileBar />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </DocsSearch>
  );
}

function DocsSidebar({ nav }: { nav: DocsGroup[] }) {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  return (
    // On a phone the sheet opens from the right, next to the menu button, as the app's does.
    <Sidebar side={isMobile ? 'right' : 'left'}>
      <SidebarHeader className="gap-3 px-3 pt-4 pb-2">
        <Link href="/docs" onClick={close} className="flex items-center gap-2 px-1" aria-label="Spooldoc docs">
          <Logo className="h-8" />
          <span className="font-medium text-muted-foreground text-sm">Docs</span>
        </Link>
        <DocsSearchButton className="w-full justify-start" />
      </SidebarHeader>
      <SidebarContent>
        {nav.map(({ group, pages }) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pages.map((page) => (
                  <SidebarMenuItem key={page.slug}>
                    <SidebarMenuButton asChild isActive={pathname === `/docs/${page.slug}`}>
                      <Link href={`/docs/${page.slug}`} onClick={close}>
                        {page.title}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/">
                <ArrowLeftIcon />
                <span>Open Spooldoc</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** On phones: the wordmark, search and the menu button that opens the sidebar. */
function MobileBar() {
  const { toggleSidebar } = useSidebar();
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 pr-2 md:hidden">
      <Link href="/docs" aria-label="Spooldoc docs" className="mr-auto flex items-center gap-2">
        <Logo className="h-6" />
        <span className="font-medium text-muted-foreground text-sm">Docs</span>
      </Link>
      <DocsSearchButton className="w-28" />
      <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu">
        <MenuIcon />
      </Button>
    </header>
  );
}
