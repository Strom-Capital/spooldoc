'use client';

import {
  ArrowUpRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  CircleDotIcon,
  HomeIcon,
  ImageIcon,
  InboxIcon,
  LogOutIcon,
  MessagesSquareIcon,
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
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { REPOSITORY } from '@/lib/repository';
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
 * Wordmark, the pages, Settings and Profile, Support (the docs, and the repository's
 * discussions and issues, each in a new tab), and Sign out at the bottom. On desktop it
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
        <NavGroup label="Settings" collapsed={collapsed}>
          <PageLink href="/settings" label="Settings" icon={SettingsIcon} active={pathname.startsWith('/settings')} onClick={close} />
          <PageLink href="/profile" label="Profile" icon={UserIcon} active={pathname.startsWith('/profile')} onClick={close} />
        </NavGroup>
        <NavGroup label="Support" collapsed={collapsed}>
          <ExternalLink href="/docs" label="Docs" icon={BookOpenIcon} onClick={close} />
          <ExternalLink href={`${REPOSITORY}/discussions`} label="Discussions" icon={MessagesSquareIcon} onClick={close} />
          <ExternalLink href={`${REPOSITORY}/issues`} label="Issues" icon={CircleDotIcon} onClick={close} />
        </NavGroup>
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

/**
 * A labelled group that folds away from its label. Open by default, and always open on
 * the icon rail, where the label is hidden.
 */
function NavGroup({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open || collapsed} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <CollapsibleTrigger>
            {label}
            <ChevronDownIcon className="ml-auto transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>{children}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** A link that opens in a new tab, marked with an arrow. */
function ExternalLink({ href, label, icon: Icon, onClick }: { href: string; label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={label}>
        <a href={href} target="_blank" rel="noreferrer" onClick={onClick}>
          <Icon />
          <span>{label}</span>
          <ArrowUpRightIcon className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
