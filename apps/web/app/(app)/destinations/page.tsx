import type { Metadata } from 'next';
import { DestinationsPage } from '@/components/pages/destinations-page';

export const metadata: Metadata = { title: 'Destinations' };

/** Where jobs deliver documents. */
export default function Page() {
  return <DestinationsPage />;
}
