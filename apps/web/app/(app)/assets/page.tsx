import type { Metadata } from 'next';
import { AssetsPage } from '@/components/pages/assets-page';

export const metadata: Metadata = { title: 'Assets' };

/** Images and fonts templates print with `asset('name')`. */
export default function Page() {
  return <AssetsPage />;
}
