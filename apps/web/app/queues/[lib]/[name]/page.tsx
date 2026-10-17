import type { Metadata } from 'next';
import Link from 'next/link';
import { SpooledFileTable } from '@/components/pages/spooled-file-table';

export const metadata: Metadata = { title: 'Spooled files · Spooldoc' };

/** Spooled files of one output queue. */
export default async function QueuePage({ params }: PageProps<'/queues/[lib]/[name]'>) {
  const { lib, name } = await params;
  const library = decodeURIComponent(lib).toUpperCase();
  const queue = decodeURIComponent(name).toUpperCase();
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <p className="text-muted-foreground text-sm">
        <Link href="/queues" className="hover:underline">
          Queues
        </Link>{' '}
        / {library}
      </p>
      <h1 className="font-semibold text-2xl tracking-tight">
        <span className="font-mono">{library}/{queue}</span>
      </h1>
      <p className="mt-1 mb-6 text-muted-foreground text-sm">Capture a spooled file to open it in the workbench.</p>
      <SpooledFileTable library={library} queue={queue} />
    </main>
  );
}
