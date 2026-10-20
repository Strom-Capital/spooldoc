'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jobState } from '@/lib/client/jobs';
import type { QueueView } from '@/lib/types';

/**
 * How many jobs there are, as a count. Hovering the count, or clicking, tapping or
 * pressing Enter on it, lists them, each linked to its job with its state. No jobs
 * show a muted 0.
 */
export function JobsPopover({
  jobs,
  label,
  heading,
  footer,
}: {
  jobs: QueueView['jobs'];
  /** The count's accessible name, such as "2 jobs read from MYLIB/MYOUTQ". */
  label: string;
  /** The line above the list. */
  heading: string;
  /** A note below the list. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // How the list opened: from hover it leaves focus where it is and closes when the pointer leaves.
  const openedBy = useRef<'hover' | 'press'>('press');
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );

  if (jobs.length === 0) {
    return <span className="text-muted-foreground">0</span>;
  }

  function changeOpen(next: boolean) {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    if (next) openedBy.current = 'press';
    setOpen(next);
  }
  function hoverIn(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(closeTimer.current);
    if (open) return;
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      openedBy.current = 'hover';
      setOpen(true);
    }, 200);
  }
  function hoverOut(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(openTimer.current);
    if (!open || openedBy.current !== 'hover') return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          onClick={(event) => {
            // A click on a list hover opened keeps it open, as if the click had opened it.
            if (open && openedBy.current === 'hover') {
              event.preventDefault();
              clearTimeout(closeTimer.current);
              openedBy.current = 'press';
            }
          }}
          aria-label={label}
          className="rounded-sm underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {jobs.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="gap-0 text-left"
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onOpenAutoFocus={(event) => {
          if (openedBy.current === 'hover') event.preventDefault();
        }}
      >
        <div className="mb-1.5 font-medium text-muted-foreground text-xs">{heading}</div>
        <ul className="space-y-1">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-baseline justify-between gap-3">
              <Link href={`/jobs/${job.id}`} className="min-w-0 truncate text-primary hover:underline">
                {job.name}
              </Link>
              <span className="shrink-0 text-muted-foreground text-xs">{jobState(job)}</span>
            </li>
          ))}
        </ul>
        {footer && <p className="mt-2 border-t pt-2 text-muted-foreground text-xs">{footer}</p>}
      </PopoverContent>
    </Popover>
  );
}
