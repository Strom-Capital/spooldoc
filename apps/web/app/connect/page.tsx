import type { Metadata } from 'next';
import { ConnectForm } from '@/components/pages/connect-form';
import { getConfig } from '@/lib/server/config';

export const metadata: Metadata = { title: 'Connect · Spooldoc' };
export const dynamic = 'force-dynamic';

/** Sign on to an IBM i. */
export default function ConnectPage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <h1 className="font-semibold text-2xl tracking-tight">Connect to an IBM i</h1>
      <p className="mt-1 mb-6 text-muted-foreground text-sm">
        The password stays in an encrypted session cookie and in this server&apos;s connection cache.
      </p>
      <ConnectForm allowedHosts={getConfig().allowedHosts} />
    </main>
  );
}
