import { CircleAlertIcon, RadioIcon, WorkflowIcon, XCircleIcon, XIcon, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ReconnectButton, serverState, ServerStateIcon, sinceTime, stateWord } from '@/components/server-status';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ago } from '@/lib/client/format';
import type { AttentionItem, DashboardView } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One row of Needs attention. */
interface Row {
  item: AttentionItem;
  /** The icon, or a server's state, whose icon shows in its colour. */
  icon: LucideIcon | { state: ReturnType<typeof serverState> };
  warn: boolean;
  title: string;
  text: string;
  href: string;
  when: string;
  /** A server's Reconnect. */
  server?: { id: string; name: string };
}

/**
 * Servers Spooldoc cannot reach or sign on to, jobs that fail to watch, queues polled
 * because real-time watching stopped, and the latest failed and warning runs, each with
 * Dismiss. A server also has Reconnect. Hidden when all is well.
 */
export function AttentionList({
  attention,
  onDismiss,
  onReconnected,
}: {
  attention: DashboardView['attention'];
  onDismiss(items: AttentionItem[]): void;
  /** Reconnect worked: load the list again. */
  onReconnected(): void;
}) {
  const items: Row[] = [
    ...attention.servers.map((s) => {
      const state = serverState({ lastError: s.error, errorCode: s.errorCode, lastCheckedAt: null });
      return {
        item: { kind: 'server', id: s.id } as const,
        icon: { state },
        warn: state === 'unreachable',
        title: s.name,
        text: `${stateWord(state)}: ${s.error}`,
        href: '/servers',
        when: s.since ? `since ${sinceTime(s.since)}` : '',
        server: { id: s.id, name: s.name },
      };
    }),
    ...attention.jobs.map((j) => ({ item: { kind: 'job', id: j.id } as const, icon: WorkflowIcon, warn: false, title: j.name, text: j.error, href: `/jobs/${j.id}`, when: '' })),
    ...attention.queues.map((q) => ({
      item: { kind: 'queue', id: q.id } as const,
      icon: RadioIcon,
      warn: true,
      title: `${q.library}/${q.name} on ${q.serverName}`,
      text: `Polled, as real-time watching stopped: ${q.error}`,
      href: `/queues/${q.serverId}/${encodeURIComponent(q.library)}/${encodeURIComponent(q.name)}`,
      when: ago(q.since),
    })),
    ...attention.runs.map((r) => ({
      item: { kind: 'run', id: r.id } as const,
      icon: r.status === 'warning' ? CircleAlertIcon : XCircleIcon,
      warn: r.status === 'warning',
      title: `${r.jobName}, run #${r.seq}`,
      text: r.error ?? (r.status === 'warning' ? 'Warning' : 'Failed'),
      href: `/runs?job=${r.jobId}&status=${r.status}`,
      when: ago(r.startedAt),
    })),
  ];
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs attention</CardTitle>
        {items.length > 1 && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onDismiss(items.map((i) => i.item))}>
              Dismiss all
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map(({ item, icon: Icon, warn, title, text, href, when, server }) => (
            <li key={`${item.kind}${item.id}`} className="flex items-center gap-1">
              <Link href={href} className="-ml-2 flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                {'state' in Icon ? (
                  <ServerStateIcon state={Icon.state} className="mt-0.5" />
                ) : (
                  <Icon className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-amber-700 dark:text-amber-400' : 'text-destructive')} aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{title}</div>
                  <div className="truncate text-muted-foreground text-xs">{text}</div>
                </div>
                {when && <span className="shrink-0 text-muted-foreground text-xs">{when}</span>}
              </Link>
              {server && <ReconnectButton server={server} variant="ghost" onDone={(view) => view && onReconnected()} />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Dismiss ${title}`} onClick={() => onDismiss([item])}>
                    <XIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
