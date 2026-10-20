import { ArrowUpRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A link into the docs at /docs. It opens in a new tab, so the page the user is on
 * stays as it is.
 *
 * @param page - The guide, its file name in docs/ without `.md`, such as `templates`
 * @param anchor - A heading on that page, as GitHub writes it, such as `tags-in-word`
 */
export function DocsLink({ page, anchor, children, className }: { page: string; anchor?: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={`/docs/${page}${anchor ? `#${anchor}` : ''}`}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline', className)}
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
    </a>
  );
}
