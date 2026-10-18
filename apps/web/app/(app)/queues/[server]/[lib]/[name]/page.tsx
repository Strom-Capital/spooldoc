import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { QueueFilesPage } from '@/components/pages/queue-files-page';
import { getServerRow } from '@/lib/server/servers';

type Params = { server: string; lib: string; name: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { lib, name } = await params;
  return { title: `${decodeURIComponent(lib)}/${decodeURIComponent(name)}` };
}

/** The spooled files of one output queue. */
export default async function QueuePage({ params }: { params: Promise<Params> }) {
  const { server: serverId, lib, name } = await params;
  const server = await getServerRow(serverId);
  if (!server) {
    notFound();
  }
  return (
    <QueueFilesPage
      serverId={server.id}
      serverName={server.name}
      library={decodeURIComponent(lib).toUpperCase()}
      queue={decodeURIComponent(name).toUpperCase()}
    />
  );
}
