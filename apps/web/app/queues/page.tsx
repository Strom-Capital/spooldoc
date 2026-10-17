import type { Metadata } from 'next';
import { QueueList } from '@/components/pages/queue-list';

export const metadata: Metadata = { title: 'Queues · Spooldoc' };

/** Output queues on the connected system. */
export default function QueuesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="font-semibold text-2xl tracking-tight">Output queues</h1>
      <p className="mt-1 mb-6 text-muted-foreground text-sm">Pick a queue to see its spooled files.</p>
      <QueueList />
    </main>
  );
}
