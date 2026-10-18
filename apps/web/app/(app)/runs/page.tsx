import type { Metadata } from 'next';
import { RunsPage } from '@/components/pages/runs-page';

export const metadata: Metadata = { title: 'Job log' };

/** Every run of every job. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <RunsPage job={params.job ?? ''} status={params.status ?? ''} from={params.from ?? ''} to={params.to ?? ''} />;
}
