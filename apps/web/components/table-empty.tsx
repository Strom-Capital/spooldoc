import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** An empty state inside a table: a large icon, a title, a line of text and actions. */
export function TableEmpty({
  colSpan,
  icon: Icon,
  title,
  description,
  children,
}: {
  colSpan: number;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia className="size-14 rounded-full bg-muted text-muted-foreground">
              <Icon className="size-7" aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          {children && <EmptyContent className="flex-row flex-wrap justify-center gap-2">{children}</EmptyContent>}
        </Empty>
      </td>
    </tr>
  );
}
