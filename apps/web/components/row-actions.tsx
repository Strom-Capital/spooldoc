'use client';

import { MoreHorizontalIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { opensRow, wantsNewTab } from '@/lib/client/row-click';
import { cn } from '@/lib/utils';

/**
 * The props that make a table row open on a click anywhere but its controls: a page
 * (href) or a dialog or sheet (a callback). The row's name is the keyboard target: a
 * link to the same page, or a button. A page opens in a new tab as a link would.
 */
export function useRowOpen() {
  const router = useRouter();
  return useCallback(
    (open: string | (() => void), className?: string) => {
      function onClick(event: MouseEvent<HTMLTableRowElement>) {
        const target = event.target instanceof Element ? event.target : null;
        if (!opensRow({ target, row: event.currentTarget, selection: window.getSelection()?.toString() ?? '' })) return;
        if (typeof open === 'function') open();
        else if (wantsNewTab(event)) window.open(open, '_blank', 'noopener');
        else router.push(open);
      }
      return {
        className: cn('group/row cursor-pointer hover:bg-muted/40', className),
        onClick,
        // The middle button fires auxclick, not click.
        onAuxClick: typeof open === 'string' ? (event: MouseEvent<HTMLTableRowElement>) => event.button === 1 && onClick(event) : undefined,
      };
    },
    [router],
  );
}

/** The name of a row that opens a dialog or sheet: its keyboard target, styled as the name links are. */
export function RowOpenButton({ className, ...props }: Omit<ComponentProps<'button'>, 'type'>) {
  return (
    <button
      type="button"
      className={cn('rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  );
}

/**
 * One of the at most two actions a row shows besides its menu: a quiet ghost button
 * with an icon and a label. One that only some rows have goes first.
 */
export function RowAction({ className, ...props }: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('text-muted-foreground group-focus-within/row:text-foreground group-hover/row:text-foreground', className)}
      {...props}
    />
  );
}

/**
 * The ⋯ menu that holds every action of a row, the inline one first and destructive
 * ones last after a separator. `label` names the row for screen readers.
 */
export function RowMenu({ label, busy = false, children }: { label: string; busy?: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} disabled={busy}>
          {busy ? <Spinner /> : <MoreHorizontalIcon />}
        </Button>
      </DropdownMenuTrigger>
      {/* As wide as its longest item, not the trigger, so no item wraps. */}
      <DropdownMenuContent align="end" className="w-auto min-w-36">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The header of the actions column, named for screen readers only. */
export function ActionsHead({ rowSpan }: { rowSpan?: number }) {
  return (
    <th rowSpan={rowSpan} className="px-3 py-2">
      <span className="sr-only">Actions</span>
    </th>
  );
}

/** The actions cell: right-aligned and as narrow as its buttons, which line up with the row's first line of text. */
export function ActionsCell({ children }: { children: ReactNode }) {
  return (
    <td className="w-0 whitespace-nowrap px-3 py-1.5">
      <div className="flex items-center justify-end gap-1">{children}</div>
    </td>
  );
}
