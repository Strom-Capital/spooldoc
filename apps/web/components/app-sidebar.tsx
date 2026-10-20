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
  type LucideIcon,
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/client/auth';
import { shortcut } from '@/lib/client/keys';
import { useAppInfo } from './app-info';
import { Logo } from './logo';
import { ThemeMenuItems } from './theme-menu';

/** The daily pages in the order the work goes, then the pages set up once. */
const PAGES = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/queues', label: 'Queues', icon: InboxIcon },
  { href: '/jobs', label: 'Jobs', icon: WorkflowIcon },
  { href: '/runs', label: 'Job log', icon: ScrollTextIcon },
  { href: '/servers', label: 'Servers', icon: ServerIcon },
  { href: '/destinations', label: 'Destinations', icon: SendIcon },
  { href: '/assets', label: 'Assets', icon: ImageIcon },
];

/**
 * Wordmark, the pages, settings and the account menu (with the theme). On desktop it
 * collapses to an icon rail (Cmd/Ctrl+B or the toggle by the logo) so the job builder
 * gets the width. On phones it opens from the menu button at the top right.
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
    <Sidebar collapsible="icon" side={isMobile ? 'right' : 'left'}>
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
            <TooltipContent side="right">
              {collapsed ? 'Expand' : 'Collapse'} ({shortcut('B')})
            </TooltipContent>
          </Tooltip>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map((page) => (
                <PageLink key={page.href} {...page} active={page.href === '/' ? pathname === '/' : pathname.startsWith(page.href)} onClick={close} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <PageLink href="/settings" label="Settings" icon={SettingsIcon} active={pathname.startsWith('/settings')} onClick={close} />
              <SidebarMenuItem>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuButton aria-label={`Account: ${user.email}`}>
                          <UserIcon />
                          <span className="truncate">{user.email}</span>
                        </SidebarMenuButton>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    {collapsed && <TooltipContent side="right">{user.email}</TooltipContent>}
                  </Tooltip>
                  <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <span className="block truncate font-medium">{user.name}</span>
                      <span className="block truncate text-muted-foreground text-xs">{user.email}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ThemeMenuItems />
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onSignOut}>
                      <LogOutIcon />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function PageLink({ href, label, icon: Icon, active, onClick }: { href: string; label: string; icon: LucideIcon; active: boolean; onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href} onClick={onClick}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
