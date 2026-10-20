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

/**
 * A red message box for an error. `detail`, such as the IBM i's own message text, is
 * kept behind a Details toggle so the message itself says what to do. `action`, such as
 * a Try again button, sits at the bottom.
 */
export function ErrorNote({ children, detail, action, className }: { children: ReactNode; detail?: string; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm', className)}>
      {children}
      {detail && (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer select-none rounded-sm opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40">
            Details
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">{detail}</p>
        </details>
      )}
      {action && <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground">{action}</div>}
    </div>
  );
}

