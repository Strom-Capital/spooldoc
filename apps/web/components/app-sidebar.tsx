'use client';

import { FileTextIcon, InboxIcon, LogInIcon, LogOutIcon, PanelLeftIcon, ServerIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Logo } from './logo';
import { useSession } from './session-provider';
import { ThemeMenu } from './theme-menu';

const PAGES = [
  { href: '/queues', label: 'Queues', icon: InboxIcon },
  { href: '/samples', label: 'Samples', icon: FileTextIcon },
];

/**
 * Wordmark, navigation, theme and the connection badge. On desktop it collapses to an
 * icon rail (Cmd/Ctrl+B or the toggle by the logo) so the workbench gets the width.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { session, disconnect } = useSession();
  const { setOpenMobile, state, isMobile, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  const close = () => setOpenMobile(false);

  async function onDisconnect() {
    await disconnect();
    // A full page load drops pages the router fetched while signed on.
    window.location.assign(new URL('/connect', window.location.href));
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between gap-1 px-3 pt-4 pb-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-2">
        <Link href="/" onClick={close} className="px-1 group-data-[collapsible=icon]:px-0" aria-label="Spooldoc home">
          {collapsed ? <Logo mark className="mx-auto h-7" /> : <Logo className="h-8" />}
        </Link>
        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                <PanelLeftIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? 'Expand' : 'Collapse'} (Ctrl+B)</TooltipContent>
          </Tooltip>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map((page) => (
                <SidebarMenuItem key={page.href}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(page.href)} tooltip={page.label}>
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
      <SidebarFooter className="gap-2 p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-2">
        {collapsed ? (
          <CollapsedConnection onDisconnect={onDisconnect} />
        ) : (
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
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">Theme</span>
          <ThemeMenu />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** The connection as one icon in the collapsed rail: the server when connected, else Connect. */
function CollapsedConnection({ onDisconnect }: { onDisconnect: () => void }) {
  const { session } = useSession();
  if (session?.connected) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onDisconnect} aria-label={`Disconnect ${session.user}@${session.host}`}>
            <ServerIcon className="text-primary" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {session.user}@{session.host}, click to disconnect
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon">
          <Link href="/connect" aria-label="Connect">
            <LogInIcon className="text-muted-foreground" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{session ? 'Not connected: connect' : 'Checking...'}</TooltipContent>
    </Tooltip>
  );
}
