import { redirect } from 'next/navigation';
import { listSamples } from '@/lib/server/samples';

export const dynamic = 'force-dynamic';

/** Samples when there are any, else the connect form. */
export default async function Home() {
  const samples = await listSamples().catch(() => []);
  redirect(samples.length > 0 ? '/samples' : '/connect');
}
