import { cn } from 'cn';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';

/** One step of a page's breadcrumb trail; without `href` it is the current page. */
type Crumb = { label: ReactNode; href?: string };

/**
 * A page with a breadcrumb trail, a title, a description and actions on the right. The
 * trail starts at the section, with no Home in front: each item with an `href` links to a
 * page above, and the last item, without one, names this page. Without `breadcrumbs` the
 * trail is the title alone, so the title sits in the same place on every page.
 */
export function Page({
  title,
  description,
  actions,
  breadcrumbs,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  children: ReactNode;
  className?: string;
}) {
  const trail: Crumb[] = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : [{ label: title }];
  return (
    <main className={cn('mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8', className)}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb className="mb-1.5">
            <BreadcrumbList>
              {trail.map((crumb, i) => (
                <Fragment key={crumb.href ?? 'current'}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className="min-w-0">
                    {crumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

