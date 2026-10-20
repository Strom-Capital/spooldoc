import {
  ArchiveIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CircleIcon,
  CirclePauseIcon,
  CircleStopIcon,
  ClockIcon,
  HourglassIcon,
  type LucideIcon,
  MessageSquareWarningIcon,
  PenLineIcon,
  PrinterIcon,
  SendIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { type SpooledFileStatus as Status, type SpooledFileTone, spooledFileStatusLabel, spooledFileTone } from '@/lib/spooled-file-status';
import { cn } from '@/lib/utils';

const ICON: Record<Status, LucideIcon> = {
  READY: CircleCheckIcon,
  HELD: CirclePauseIcon,
  OPEN: PenLineIcon,
  WRITING: PenLineIcon,
  PENDING: HourglassIcon,
  PRINTING: PrinterIcon,
  SENDING: SendIcon,
  MESSAGE: MessageSquareWarningIcon,
  SAVED: ArchiveIcon,
  DEFERRED: ClockIcon,
  CLOSED: CircleStopIcon,
  FINISHED: CheckCheckIcon,
};

const TONE_CLASS: Record<SpooledFileTone, string> = {
  ready: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  held: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  busy: 'bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  message: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  neutral: 'bg-muted text-muted-foreground',
};

/** The icon of a spooled file status; a plain circle for one Spooldoc does not know. */
const iconOf = (status: string): LucideIcon => ICON[status.trim().toUpperCase() as Status] ?? CircleIcon;

/** A spooled file status as a tinted pill: an icon and the word, with the IBM i value as its tooltip. */
export function SpooledFileStatus({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="secondary" title={status} className={cn(TONE_CLASS[spooledFileTone(status)], className)}>
      {createElement(iconOf(status), { 'aria-hidden': true })}
      {spooledFileStatusLabel(status)}
    </Badge>
  );
}
