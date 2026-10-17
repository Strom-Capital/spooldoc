import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Workbench } from '@/components/workbench/workbench';
import { getWorkspace } from '@/lib/server/workspace';

export const metadata: Metadata = { title: 'Workbench · Spooldoc' };
export const dynamic = 'force-dynamic';

/** The workbench for one sample. */
export default async function SamplePage({ params }: PageProps<'/samples/[id]'>) {
  const { id } = await params;
  const sample = await getWorkspace()
    .readSample(decodeURIComponent(id))
    .catch(() => null);
  if (!sample) {
    notFound();
  }
  return <Workbench sampleId={sample.id} />;
}
