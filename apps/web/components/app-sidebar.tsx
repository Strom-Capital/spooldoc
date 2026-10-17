'use client';

import { FileTextIcon, InboxIcon, LogInIcon, LogOutIcon, ServerIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Logo } from './logo';
import { useSession } from './session-provider';
import { ThemeMenu } from './theme-menu';

const PAGES = [
  { href: '/queues', label: 'Queues', icon: InboxIcon },
  { href: '/samples', label: 'Samples', icon: FileTextIcon },
];

/** Wordmark, navigation, theme and the connection badge. */
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, disconnect } = useSession();
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);

  async function onDisconnect() {
    await disconnect();
    router.push('/connect');
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link href="/" onClick={close} className="px-1" aria-label="Spooldoc home">
          <Logo className="h-8" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map((page) => (
                <SidebarMenuItem key={page.href}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(page.href)}>
                    <Link href={page.href} onClick={close}>
                      <page.icon />
                      <span>{page.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2 p-3">
        <div className="rounded-md border bg-background/60 p-2 text-sm">
          {session?.connected ? (
            <div className="flex items-center gap-2">
              <ServerIcon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium" title={`${session.user}@${session.host}`}>
                {session.user}@{session.host}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={onDisconnect} aria-label="Disconnect" title="Disconnect">
                <LogOutIcon />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-muted-foreground">{session ? 'Not connected' : 'Checking...'}</span>
              <Button asChild variant="outline" size="sm">
                <Link href="/connect" onClick={close}>
                  <LogInIcon />
                  Connect
                </Link>
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Theme</span>
          <ThemeMenu />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
