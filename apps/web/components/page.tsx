import { cn } from 'cn';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** A page with a title, a description and actions on the right; `back` links to the page above, left of the actions. */
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
        </div>
        {(actions || back) && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Beside the actions, not above the title, so the heading stays put between pages. */}
            {back && (
              <Button asChild variant="ghost">
                <Link href={back.href}>
                  <ArrowLeftIcon aria-hidden />
                  {back.label}
                </Link>
              </Button>
            )}
            {actions}
          </div>
        )}
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
