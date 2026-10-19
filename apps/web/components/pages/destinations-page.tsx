'use client';

import { DownloadIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/empty-state';
import { ErrorNote, Page } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { api, errorText } from '@/lib/client/api';
import type { DestinationView } from '@/lib/types';

/** The destinations jobs can deliver to, with the jobs that use each. */
export function DestinationsPage() {
  const [destinations, setDestinations] = useState<DestinationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ destinations: DestinationView[] }>('/api/destinations').then(
      (data) => setDestinations(data.destinations),
      (err) => setError(errorText(err)),
    );
  }, []);

  return (
    <Page title="Destinations" description="Where jobs deliver their documents.">
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {destinations === null && !error && (
        <Loading>Loading destinations...</Loading>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {destinations?.map((destination) => (
          <section key={destination.id} className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <DownloadIcon className="size-5 text-primary" aria-hidden />
              <h2 className="font-semibold">{destination.name}</h2>
              {destination.builtin && <Badge variant="secondary">Built in</Badge>}
            </div>
            <p className="mt-2 text-muted-foreground text-sm">
              PDF and HTML files are stored in Spooldoc&apos;s database. Download them from the Job log, or from Run now.
            </p>
            <div className="mt-3 text-sm">
              {destination.jobs.length === 0 ? (
                <span className="text-muted-foreground">No job uses it yet.</span>
              ) : (
                <>
                  <span className="text-muted-foreground">Used by </span>
                  {destination.jobs.map((job, index) => (
                    <span key={job.id}>
                      {index > 0 && ', '}
                      <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                        {job.name}
                      </Link>
                    </span>
                  ))}
                </>
              )}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}
