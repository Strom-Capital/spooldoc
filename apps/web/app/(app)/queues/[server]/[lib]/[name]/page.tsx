import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewJobButton } from '@/components/pages/new-job-button';
import { SpooledFileTable } from '@/components/pages/spooled-file-table';
import { Page } from '@/components/page';
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
  const library = decodeURIComponent(lib).toUpperCase();
  const queue = decodeURIComponent(name).toUpperCase();
  return (
    <Page
      back={{ href: `/queues?server=${server.id}`, label: 'Queues' }}
      title={
        <>
          <span className="font-mono">{library}/{queue}</span>
        </>
      }
      description={
        <>
          Spooled files on{' '}
          <Link href="/servers" className="hover:underline">
            {server.name}
          </Link>
          , newest first.
        </>
      }
      actions={<NewJobButton source={{ serverId: server.id, library, queue }} label="New job from this queue" />}
    >
      <SpooledFileTable serverId={server.id} library={library} queue={queue} />
    </Page>
  );
}
