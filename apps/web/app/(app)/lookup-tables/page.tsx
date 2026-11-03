import type { Metadata } from 'next';
import { LookupTablesPage } from '@/components/pages/lookup-tables-page';

export const metadata: Metadata = { title: 'Lookup tables' };

/** Lookup tables kept in Spooldoc, which table lookups match rows of. */
export default function Page() {
  return <LookupTablesPage />;
}
