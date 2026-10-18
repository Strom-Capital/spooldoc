import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** One headline number with a label, a line of context, and a link to the page behind it. */
export function KpiTile({ label, value, detail, href, icon: Icon }: { label: string; value: number | null; detail: string; href: string; icon: LucideIcon }) {
  return (
    <Link href={href} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full gap-1 px-4 transition-colors group-hover:bg-muted/50">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-sm">{label}</span>
          <Icon className="size-4" aria-hidden />
        </div>
        {value === null ? <Skeleton className="my-1 h-8 w-16" /> : <div className="font-semibold text-3xl tabular-nums tracking-tight">{value.toLocaleString()}</div>}
        <div className="truncate text-muted-foreground text-xs">{value === null ? ' ' : detail}</div>
      </Card>
    </Link>
  );
}
