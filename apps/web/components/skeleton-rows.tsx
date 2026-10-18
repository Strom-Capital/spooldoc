import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Placeholder table rows while the first rows load: one bar per column, with the
 * widths given (Tailwind width classes), so the table keeps its shape.
 */
export function SkeletonRows({ widths, rows = 5, className }: { widths: string[]; rows?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden className={cn('border-t', className)}>
          {widths.map((width, column) => (
            <td key={column} className="px-3 py-2.5">
              {/* Later rows a little shorter, so the placeholder does not look like a grid. */}
              <Skeleton className={cn('h-4', width, row % 2 === 1 && column > 1 && 'opacity-70')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
