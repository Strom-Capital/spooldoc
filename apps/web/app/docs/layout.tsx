import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DocsShell } from '@/components/docs/docs-shell';
import { docsNav } from '@/lib/server/docs';

export const metadata: Metadata = { title: { default: 'Docs', template: '%s | Spooldoc docs' } };

/**
 * The guides from docs/, prerendered when the app is built, so they match the version
 * that runs. Outside the app layout and open without signing in, as they are on GitHub.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell nav={docsNav()}>{children}</DocsShell>;
}
