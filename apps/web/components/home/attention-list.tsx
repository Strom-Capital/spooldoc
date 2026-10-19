import { CircleAlertIcon, RadioIcon, ServerIcon, WorkflowIcon, XCircleIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ago } from '@/lib/client/format';
import type { AttentionItem, DashboardView } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Servers that fail to connect, jobs that fail to watch, queues polled because real-time
 * watching stopped, and the latest failed and warning runs, each with Dismiss. Hidden
 * when all is well.
 */
export function AttentionList({ attention, onDismiss }: { attention: DashboardView['attention']; onDismiss(items: AttentionItem[]): void }) {
  const items = [
    ...attention.servers.map((s) => ({ item: { kind: 'server', id: s.id } as const, icon: ServerIcon, warn: false, title: s.name, text: s.error, href: '/servers', when: '' })),
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
          {items.map(({ item, icon: Icon, warn, title, text, href, when }) => (
            <li key={`${item.kind}${item.id}`} className="flex items-center gap-1">
              <Link href={href} className="-ml-2 flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <Icon className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-amber-700 dark:text-amber-400' : 'text-destructive')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{title}</div>
                  <div className="truncate text-muted-foreground text-xs">{text}</div>
                </div>
                {when && <span className="shrink-0 text-muted-foreground text-xs">{when}</span>}
              </Link>
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
