import { cn } from 'cn';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** A page with a title, a description and actions on the right; `back` links to the page above. */
export function Page({
  title,
  description,
  actions,
  back,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8', className)}>
      {back && (
        <Link href={back.href} className="-ml-1 mb-3 inline-flex items-center gap-1 rounded px-1 text-muted-foreground text-sm hover:text-foreground">
          <ArrowLeftIcon className="size-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

/** A red message box for an error. */
export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm', className)}>
      {children}
    </p>
  );
}

/** A muted box for an empty list. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">{children}</div>;
}
