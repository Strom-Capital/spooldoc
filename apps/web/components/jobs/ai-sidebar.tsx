'use client';

import { MousePointerClickIcon, PanelRightCloseIcon } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { useJob } from './job-provider';

const PHONE = '(max-width: 767px)';
function subscribePhone(onChange: () => void) {
  const media = window.matchMedia(PHONE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const key = (jobId: string) => `spooldoc.job.${jobId}.ai`;

function readChoice(jobId: string): 'open' | 'closed' | null {
  try {
    const value = localStorage.getItem(key(jobId));
    return value === 'open' || value === 'closed' ? value : null;
  } catch {
    return null;
  }
}

function writeChoice(jobId: string, value: 'open' | 'closed') {
  try {
    localStorage.setItem(key(jobId), value);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/**
 * Whether the agent sidebar is open. It remembers the choice per job, and opens by itself
 * the first time the job has a preview spooled file and no definition yet, so the first
 * version is one click away.
 */
export function useAiSidebar(): { open: boolean; setOpen(open: boolean): void } {
  const { job, spec } = useJob();
  const { sampleId } = useWorkbench();
  const saved = useSyncExternalStore(subscribeNothing, () => readChoice(job.id), () => null);
  const [choice, setChoice] = useState<boolean | null>(null);
  const firstVersion = !!sampleId && !spec.extract.definition.trim();
  const open = choice ?? (saved ? saved === 'open' : firstVersion);

  // Remember the automatic opening, so it stays open once the definition exists.
  useEffect(() => {
    if (!saved && firstVersion) writeChoice(job.id, 'open');
  }, [saved, firstVersion, job.id]);

  return {
    open,
    setOpen(next) {
      setChoice(next);
      writeChoice(job.id, next ? 'open' : 'closed');
    },
  };
}

const subscribeNothing = () => () => undefined;

/** The agent beside the builder (a sheet on small screens), and the button that opens it. */
export function AiSidebar({ open, setOpen, children }: { open: boolean; setOpen(open: boolean): void; children: ReactNode }) {
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Agent</SheetTitle>
          <div className="h-full pt-8">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  // Stays mounted while closed, so a running answer keeps streaming.
  return (
    <aside aria-label="Agent" className={open ? 'relative flex w-[380px] shrink-0 flex-col border-l' : 'hidden'}>
      <Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5 z-10" onClick={() => setOpen(false)} aria-label="Close the agent">
        <PanelRightCloseIcon />
      </Button>
      <div className="min-h-0 flex-1 [&_section[aria-label=Agent]>div:first-child]:pr-10">{children}</div>
    </aside>
  );
}

/** Opens the agent. */
export function AiButton({ open, setOpen }: { open: boolean; setOpen(open: boolean): void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => setOpen(!open)} aria-pressed={open}>
          <MousePointerClickIcon />
          <span className="hidden sm:inline">Agent</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? 'Close' : 'Open'} the agent</TooltipContent>
    </Tooltip>
  );
}
