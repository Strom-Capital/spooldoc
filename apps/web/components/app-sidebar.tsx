'use client';

import {
  HomeIcon,
  ImageIcon,
  InboxIcon,
  LogOutIcon,
  PanelLeftIcon,
  ScrollTextIcon,
  SendIcon,
  ServerIcon,
  SettingsIcon,
  UserIcon,
  WorkflowIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { authClient } from '@/lib/client/auth';
import { useAppInfo } from './app-info';
import { Logo } from './logo';
import { ThemeMenu } from './theme-menu';

const PAGES = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/servers', label: 'Servers', icon: ServerIcon },
  { href: '/queues', label: 'Queues', icon: InboxIcon },
  { href: '/jobs', label: 'Jobs', icon: WorkflowIcon },
  { href: '/destinations', label: 'Destinations', icon: SendIcon },
  { href: '/assets', label: 'Assets', icon: ImageIcon },
  { href: '/runs', label: 'Job log', icon: ScrollTextIcon },
];

/**
 * Wordmark, navigation, settings, theme and the user menu. On desktop it collapses to
 * an icon rail (Cmd/Ctrl+B or the toggle by the logo) so the job builder gets the width.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useAppInfo();
  const { setOpenMobile, state, isMobile, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  const close = () => setOpenMobile(false);

  async function onSignOut() {
    await authClient.signOut().catch(() => undefined);
    // A full page load drops pages the router fetched while signed in.
    window.location.assign(new URL('/login', window.location.href));
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
                  <SidebarMenuButton asChild isActive={page.href === '/' ? pathname === '/' : pathname.startsWith(page.href)} tooltip={page.label}>
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
      <SidebarFooter className="gap-1 p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
              <Link href="/settings" onClick={close}>
                <SettingsIcon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="min-w-0 flex-1 justify-start gap-2 px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
                    aria-label={`Account: ${user.email}`}
                  >
                    <UserIcon />
                    <span className="truncate group-data-[collapsible=icon]:hidden">{user.email}</span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">{user.email}</TooltipContent>}
            </Tooltip>
            <DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-muted-foreground text-xs">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeMenu />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
