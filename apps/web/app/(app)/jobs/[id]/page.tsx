import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JobBuilder } from '@/components/jobs/job-builder';
import { getJobRow, jobDetail } from '@/lib/server/jobs';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const row = await getJobRow((await params).id);
  return { title: row?.name ?? 'Job' };
}

/** The job builder. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const row = await getJobRow((await params).id);
  if (!row) {
    notFound();
  }
  return <JobBuilder initial={await jobDetail(row)} />;
}
