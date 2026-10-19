'use client';

import { CircleAlertIcon, RotateCcwIcon } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';

/**
 * A page that failed while it rendered, inside the app: the sidebar stays, and Try again
 * renders the page once more. The digest matches the line in the server log.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <Page title="Something failed">
      <EmptyState
        icon={CircleAlertIcon}
        title="This page could not be shown"
        description={
          <>
            Try again. If it keeps failing, the server log has the error
            {error.digest ? (
              <>
                {' '}
                under <code className="font-mono text-xs">{error.digest}</code>
              </>
            ) : null}
            .
          </>
        }
      >
        <Button onClick={reset}>
          <RotateCcwIcon />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to Home</Link>
        </Button>
      </EmptyState>
    </Page>
  );
}
