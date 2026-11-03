import type { Metadata } from 'next';
import { LookupTablePage } from '@/components/pages/lookup-table-page';

export const metadata: Metadata = { title: 'Lookup table' };

/** One lookup table, to edit its columns and rows. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <LookupTablePage id={(await params).id} />;
}
