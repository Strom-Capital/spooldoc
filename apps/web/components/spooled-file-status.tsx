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
import { StatusPill } from '@/components/status-pill';
import { type SpooledFileStatus as Status, spooledFileStatusLabel, spooledFileTone } from '@/lib/spooled-file-status';

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

/** The icon of a spooled file status; a plain circle for one Spooldoc does not know. */
const iconOf = (status: string): LucideIcon => ICON[status.trim().toUpperCase() as Status] ?? CircleIcon;

/** A spooled file status as a tinted pill: an icon and the word, with the IBM i value as its tooltip. */
export function SpooledFileStatus({ status, className }: { status: string; className?: string }) {
  return (
    <StatusPill tone={spooledFileTone(status)} icon={iconOf(status)} title={status} className={className}>
      {spooledFileStatusLabel(status)}
    </StatusPill>
  );
}
