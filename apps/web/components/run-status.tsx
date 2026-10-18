import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon, XCircleIcon } from 'lucide-react';
import type { RunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const LABEL: Record<RunStatus, string> = { running: 'Running', success: 'Success', warning: 'Warning', failed: 'Failed' };

/** A run status as an icon and a word. */
export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const Icon = status === 'success' ? CheckCircle2Icon : status === 'warning' ? CircleAlertIcon : status === 'failed' ? XCircleIcon : LoaderCircleIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm',
        status === 'success' && 'text-emerald-700 dark:text-emerald-400',
        status === 'warning' && 'text-amber-700 dark:text-amber-400',
        status === 'failed' && 'text-destructive',
        status === 'running' && 'text-muted-foreground',
        className,
      )}
    >
      <Icon className={cn('size-4 shrink-0', status === 'running' && 'animate-spin')} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
