import type { LucideIcon } from 'lucide-react';
import { createElement, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** How a status reads at a glance: fine, waiting on someone, working, failed or just a fact. */
export type StatusTone = 'ready' | 'held' | 'busy' | 'message' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  ready: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  held: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  busy: 'bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  message: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  neutral: 'bg-muted text-muted-foreground',
};

/** A status as a tinted pill: an icon and a word or two, with more in the tooltip. */
export function StatusPill({
  tone,
  icon,
  title,
  className,
  children,
}: {
  tone: StatusTone;
  icon: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant="secondary" title={title} className={cn(TONE_CLASS[tone], className)}>
      {createElement(icon, { 'aria-hidden': true })}
      {children}
    </Badge>
  );
}
