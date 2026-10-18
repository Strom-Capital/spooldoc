import type { Metadata } from 'next';
import { ServersPage } from '@/components/pages/servers-page';
import { getConfig } from '@/lib/server/config';

export const metadata: Metadata = { title: 'Servers' };

/** Saved IBM i servers. */
export default function Page() {
  return <ServersPage allowedHosts={getConfig().allowedHosts} />;
}
