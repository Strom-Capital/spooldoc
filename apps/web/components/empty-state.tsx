import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface EmptyProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Actions, such as the button that adds the first item. */
  children?: ReactNode;
}

function EmptyBody({ icon: Icon, title, description, children, className }: EmptyProps & { className?: string }) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia className="size-14 rounded-full bg-muted text-muted-foreground">
          <Icon className="size-7" aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent className="flex-row flex-wrap justify-center gap-2">{children}</EmptyContent>}
    </Empty>
  );
}

/** The one empty state: a large icon, a title, a line of text and actions, in a dashed box. */
export function EmptyState({ className, ...props }: EmptyProps & { className?: string }) {
  return <EmptyBody {...props} className={cn('border py-12', className)} />;
}

/** The same empty state as a table row, so the table keeps its header. */
export function TableEmpty({ colSpan, ...props }: EmptyProps & { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <EmptyBody {...props} className="py-12" />
      </td>
    </tr>
  );
}

/**
 * The one loading state for a page, a list or a panel before anything is shown: a
 * spinner and what is loading, such as "Loading jobs...". A table that is already on
 * screen shows `SkeletonRows` instead, so it keeps its shape.
 */
export function Loading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center gap-2 text-muted-foreground text-sm', className)}>
      <Spinner role="presentation" aria-label={undefined} aria-hidden />
      {children}
    </div>
  );
}
