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
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { Logo } from './logo';

/**
 * The pages in the order a spooled file goes: the server and its queues, the job and the
 * assets its template uses, where the documents go, and the runs.
 */
const PAGES = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/servers', label: 'Servers', icon: ServerIcon },
  { href: '/queues', label: 'Queues', icon: InboxIcon },
  { href: '/jobs', label: 'Jobs', icon: WorkflowIcon },
  { href: '/assets', label: 'Assets', icon: ImageIcon },
  { href: '/destinations', label: 'Destinations', icon: SendIcon },
  { href: '/runs', label: 'Job log', icon: ScrollTextIcon },
];

/**
 * Wordmark, the pages, Settings and Profile, and Sign out at the bottom. On desktop it
 * collapses to an icon rail (Cmd/Ctrl+B or the toggle by the logo) so the job builder
 * gets the width. On phones it opens from the menu button at the top right.
 */
export function AppSidebar() {
  const pathname = usePathname();
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
              <PageLink href="/profile" label="Profile" icon={UserIcon} active={pathname.startsWith('/profile')} onClick={close} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={() => void onSignOut()}>
              <LogOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
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
