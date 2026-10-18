import type { Metadata } from 'next';
import { JobsPage } from '@/components/pages/jobs-page';

export const metadata: Metadata = { title: 'Jobs' };

/** Every job. */
export default function Page() {
  return <JobsPage />;
}
