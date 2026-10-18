import type { Metadata } from 'next';
import { HomePage } from '@/components/pages/home-page';

export const metadata: Metadata = { title: 'Home' };

/** Getting started, then a summary of what is set up and how the jobs have run. */
export default function Page() {
  return <HomePage />;
}
