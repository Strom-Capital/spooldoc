import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DocsLink } from '@/components/docs-link';
import { Logo } from '@/components/logo';
import { LoginForm } from '@/components/pages/login-form';
import { currentUser, userCount } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/** Sign in, or create the first account when there is none. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only paths on this site, never another origin.
  const target = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (await currentUser()) {
    redirect(target);
  }
  const firstRun = (await userCount()) === 0;
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <Logo className="mb-6 h-8" />
        <h1 className="font-semibold text-xl tracking-tight">{firstRun ? 'Create the first account' : 'Sign in'}</h1>
        <p className="mt-1 mb-6 text-muted-foreground text-sm">
          {firstRun
            ? 'There are no accounts yet. The first one you create can sign in; after that, sign-up is closed.'
            : 'Sign in to manage servers, jobs and documents.'}
        </p>
        <LoginForm firstRun={firstRun} next={target} />
        <p className="mt-6 text-center text-muted-foreground text-sm">
          New to Spooldoc? Read the <DocsLink page="getting-started">Getting started</DocsLink> guide.
        </p>
      </div>
    </main>
  );
}
