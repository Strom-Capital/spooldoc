import type { Metadata } from 'next';
import { QueuesPage } from '@/components/pages/queues-page';

export const metadata: Metadata = { title: 'Queues' };

/** Output queues of a server. */
export default async function Page({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const { server } = await searchParams;
  return <QueuesPage serverId={server ?? null} />;
}
