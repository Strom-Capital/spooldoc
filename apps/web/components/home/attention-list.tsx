import { ServerIcon, WorkflowIcon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ago } from '@/lib/client/format';
import type { DashboardView } from '@/lib/types';

/** Servers that fail to connect, jobs that fail to watch, and the latest failed runs. Hidden when all is well. */
export function AttentionList({ attention }: { attention: DashboardView['attention'] }) {
  const items = [
    ...attention.servers.map((s) => ({ key: `s${s.id}`, icon: ServerIcon, title: s.name, text: s.error, href: '/servers', when: '' })),
    ...attention.jobs.map((j) => ({ key: `j${j.id}`, icon: WorkflowIcon, title: j.name, text: j.error, href: `/jobs/${j.id}`, when: '' })),
    ...attention.runs.map((r) => ({
      key: `r${r.id}`,
      icon: XCircleIcon,
      title: `${r.jobName}, run #${r.seq}`,
      text: r.error ?? 'Failed',
      href: `/runs?job=${r.jobId}&status=failed`,
      when: ago(r.startedAt),
    })),
  ];
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map(({ key, icon: Icon, title, text, href, when }) => (
            <li key={key}>
              <Link href={href} className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <Icon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{title}</div>
                  <div className="truncate text-muted-foreground text-xs">{text}</div>
                </div>
                {when && <span className="shrink-0 text-muted-foreground text-xs">{when}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
